import { generateObject } from "ai";
import { groq } from "@ai-sdk/groq";
import { z } from "zod";

// Import the direct functions instead of using fetch for server-side calls
import { executeUserQuery } from "./sql-executor";

// Tool execution functions - using direct imports for server-side execution
async function getTablesForUser(username: string) {
  try {
    console.log("Getting tables for user:", username);
    // Use the sanitized schema name for consistency
    const schemaName = username.replace(/[^a-zA-Z0-9_]/g, "_");

    // Use direct database connection to bypass validation for table discovery
    const { neon } = await import("@neondatabase/serverless");
    const url = process.env.DATABASE_URL;
    if (!url) {
      console.error("DATABASE_URL not found");
      return [];
    }

    const sql = neon(url);

    // Helper function to execute dynamic SQL queries
    const executeDynamicSQL = async (query: string) => {
      const templateArray = Object.assign([query], {
        raw: [query],
      }) as TemplateStringsArray;
      return await sql(templateArray);
    };

    // Get tables directly (search_path doesn't persist between calls)
    const result = await executeDynamicSQL(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = '${schemaName}'
      ORDER BY tablename
    `);

    console.log("Query result:", result);
    const tables = result.map((row: any) => row.tablename);
    console.log("Extracted tables:", tables);
    return tables;
  } catch (error) {
    console.error("Error getting tables:", error);
    return [];
  }
}

async function getTableSchema(username: string, tableName: string) {
  try {
    // Use the sanitized schema name for consistency
    const schemaName = username.replace(/[^a-zA-Z0-9_]/g, "_");

    // Get columns using information_schema query that will be allowed by our validation
    const columnsQuery = `
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default,
        character_maximum_length,
        numeric_precision,
        numeric_scale
      FROM information_schema.columns
      WHERE table_schema = '${schemaName}'
      AND table_name = '${tableName}'
      ORDER BY ordinal_position
    `;

    const columnsResult = await executeUserQuery(username, columnsQuery);

    if (!columnsResult.success) {
      return null;
    }

    return {
      tableName,
      columns: columnsResult.data || [],
      primaryKeys: [], // Simplified for now
      foreignKeys: [], // Simplified for now
      indexes: [], // Simplified for now
    };
  } catch (error) {
    return null;
  }
}

// Function to identify relevant tables using AI
async function identifyRelevantTables(allTables: string[], prompt: string): Promise<string[]> {

  // If no tables not the relevant ones i meant the whole found tables are present i.e tables lenght in the schema then just return and no need to call AI
  if (allTables.length === 0) {
    return [];
  }
  
  try {
    const result = await generateObject({
      model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
      temperature: 0.1,
      maxTokens: 1024,
      schema: z.object({
        relevant_tables: z.array(z.string()).optional(),
        tables: z.array(z.string()).optional()
      }).transform((data) => ({
        tables: data.relevant_tables || data.tables || []
      })),
      prompt: `You are a database analyst. Analyze the user request and identify which tables are needed.

USER REQUEST: "${prompt}"

AVAILABLE TABLES: ${allTables.join(", ")}

RULES:
1. Return ONLY the table names that are relevant to the user's request
2. If no specific tables are mentioned but request is general (like "show all data"), return ALL tables
3. If request is about creating new tables, return empty array []
4. Return format: { "tables": ["table1", "table2"] } or { "tables": [] } for no tables needed
5. Be conservative - only include tables that are actually needed
6. If user wants to add/insert data, return the table they want to modify

Analyze the request and return the relevant tables`
    });

    const tablesResult = result.object as { tables: string[] };
    const relevantTables = tablesResult.tables || [];

    // Filter to ensure only existing tables are returned
    const validTables = relevantTables.filter(table => allTables.includes(table));

    console.log("AI identified relevant tables:", validTables);
    return validTables;
  } catch (error) {
    console.error("Error identifying relevant tables:", error);
    // Fallback to simple keyword matching
    const promptLowerCase = prompt.toLowerCase();
    return allTables.filter((table) => {
      const tableLower = table.toLowerCase();
      return (
        promptLowerCase.includes(tableLower) ||
        promptLowerCase.includes("all") ||
        promptLowerCase.includes("show")
      );
    }).slice(0, 3);
  }
}

// Main AI agent function with improved two-stage workflow
export async function generateSQLWithAgent(username: string, prompt: string) {
  try {
    console.log("AI Agent starting for user:", username, "prompt:", prompt);

    // Check if GROQ_API_KEY is available
    if (!process.env.GROQ_API_KEY) {
      throw new Error("GROQ_API_KEY environment variable is not set");
    }

    // Step 1: Get user's tables
    const tables = await getTablesForUser(username);
    console.log("Found tables:", tables);

    // Don't return error if no tables - let AI handle table creation
    console.log("Found tables:", tables.length > 0 ? tables : "No tables (will handle creation)");

    // Step 2: FIRST AI CALL - Determine which tables are needed for this request
    let relevantTableNames: string[] = [];

    if (tables.length > 0) {
      relevantTableNames = await identifyRelevantTables(tables, prompt);
      console.log("AI identified relevant tables:", relevantTableNames);
    } else {
      console.log("No existing tables - proceeding with table creation workflow");
    }

    // Step 3: Get complete schema and content for identified tables (or handle table creation)
    let schemaDescription = "";
    let existingData = "";

    if (relevantTableNames && relevantTableNames.length > 0) {
      const { getUserSchemaInfo } = await import('./schema-introspection');
      const fullSchemaInfo = await getUserSchemaInfo(username);

      // Filter schema info to only include relevant tables
      const relevantSchemaInfo = {
        tables: fullSchemaInfo.tables.filter(table =>
          relevantTableNames.includes(table.tableName)
        ),
        totalTables: relevantTableNames.length
      };

      console.log("Retrieved schema info for relevant tables:", relevantSchemaInfo);

      const { formatSchemaForAI } = await import('./schema-introspection');
      schemaDescription = await formatSchemaForAI(relevantSchemaInfo);

      // Debug: Log the schema info to see what we're getting
      console.log("DEBUG: Full schema info:", JSON.stringify(relevantSchemaInfo, null, 2));

      // Extract existing data properly
      existingData = relevantSchemaInfo.tables
        .map(table => {
          console.log(`DEBUG: Table ${table.tableName} has sampleData:`, table.sampleData);
          if (Array.isArray(table.sampleData) && table.sampleData.length > 0) {
            return `Table ${table.tableName} existing data:\n` +
                   table.sampleData.map(row => JSON.stringify(row)).join("\n");
          } else {
            return `Table ${table.tableName}: EMPTY (no existing data)`;
          }
        })
        .join("\n\n");

      console.log("DEBUG: Extracted existing data:", existingData);

      // Calculate next available IDs for each table as backup
      const nextAvailableIds: Record<string, number> = {};
      relevantSchemaInfo.tables.forEach(table => {
        if (Array.isArray(table.sampleData) && table.sampleData.length > 0) {
          // Find the highest ID value
          const idValues = table.sampleData
            .map(row => parseInt(row.id))
            .filter(id => !isNaN(id));

          if (idValues.length > 0) {
            nextAvailableIds[table.tableName] = Math.max(...idValues) + 1;
          } else {
            nextAvailableIds[table.tableName] = 1;
          }
        } else {
          nextAvailableIds[table.tableName] = 1;
        }
      });

      console.log("DEBUG: Next available IDs:", nextAvailableIds);

      // Add this critical information to the existing data
      if (Object.keys(nextAvailableIds).length > 0) {
        existingData += "\n\nCRITICAL: NEXT AVAILABLE ID VALUES:\n" +
                      Object.entries(nextAvailableIds)
                        .map(([table, nextId]) => `${table}: Start from ID ${nextId}`)
                        .join("\n");
      }
    } else {
      // For table creation or other operations that don't need existing tables
      schemaDescription = "No existing tables needed for this operation.";
    }

    // Step 4: SECOND AI CALL - Generate SQL commands with complete context
    let sqlCommands: string[] = [];

    // Handle special case for "show tables" type requests
    if (relevantTableNames.length === 0 && tables.length > 0) {
      // Check if this is a "show tables" request
      if (prompt.toLowerCase().includes("show") && (prompt.toLowerCase().includes("table") || prompt.toLowerCase().includes("all"))) {
        // Generate proper table listing query
        const schemaName = username.replace(/[^a-zA-Z0-9_]/g, "_");
        sqlCommands = [`SELECT tablename FROM pg_tables WHERE schemaname = '${schemaName}' ORDER BY tablename;`];
        return {
          success: true,
          sqlCommands
        };
      }
    }

    try {
      const result = await generateObject({
        model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
        temperature: 0.1, // Lower temperature for more consistent output
        maxTokens: 4096,
        schema: z.object({
          commands: z.array(z.string())
        }),
        prompt: `You are a PostgreSQL expert. Generate SQL commands for the user request.

USER REQUEST: "${prompt}"

USER SCHEMA: "${username.replace(/[^a-zA-Z0-9_]/g, "_")}"

COMPLETE DATABASE CONTEXT:
${schemaDescription}

EXISTING DATA IN TABLES:
${existingData}

CRITICAL RULES FOR SQL GENERATION:
1. MUST return commands array: { "commands": ["SQL1;", "SQL2;", "SQL3;"] }
2. ALL commands in the array MUST execute successfully - no optional commands
3. LOOK AT THE EXISTING DATA ABOVE - if a table shows existing records with id values, DO NOT reuse those IDs
4. For INSERT operations, examine the existing data to find the highest ID value and start from the next number
5. If existing data shows records with id 1,2,3 then start new inserts with id 4,5,6...
6. If a table shows "EMPTY (no existing data)" then start primary keys from 1
7. Each command must end with semicolon
8. Use only the tables and columns shown above (unless creating new tables)
9. Generate complete, executable SQL commands
10. No explanations or comments in the SQL
11. DO NOT include SET search_path commands - schema isolation is handled automatically
12. Focus on the actual SQL operations requested by the user
13. NEVER use psql commands like \dt, \d, \l - use proper SQL SELECT statements
14. For "show tables" requests, use: SELECT tablename FROM pg_tables WHERE schemaname = 'USER_SCHEMA_NAME'
15. For "show data" requests, use: SELECT * FROM table_name
16. Always use the correct schema name provided in USER SCHEMA field above
`
      });

      console.log("Generated commands from second AI call:", result);
      const commandsResult = result.object as { commands: string[] };
      sqlCommands = commandsResult.commands || [];

      // Validate and clean commands
      sqlCommands = sqlCommands
        .filter(cmd => cmd && cmd.trim().length > 0) // Remove empty commands
        .map(cmd => cmd.trim()) // Trim whitespace
        .map(cmd => cmd.endsWith(';') ? cmd : cmd + ';'); // Ensure semicolon

      // Ensure we have valid commands
      if (sqlCommands.length === 0) {
        throw new Error("AI generated empty or invalid commands array");
      }

      console.log("Validated commands:", sqlCommands);

    } catch (error) {
      console.error("Error in second AI call:", error);

      // Fallback logic based on prompt type
      if (relevantTableNames && relevantTableNames.length > 0) {
        if (prompt.toLowerCase().includes("show") || prompt.toLowerCase().includes("select")) {
          sqlCommands = relevantTableNames.map(tableName =>
            `SELECT * FROM "${tableName}";`
          );
        } else if (prompt.toLowerCase().includes("schema") || prompt.toLowerCase().includes("describe")) {
          sqlCommands = relevantTableNames.map(tableName =>
            `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${tableName}' ORDER BY ordinal_position;`
          );
        } else {
          return {
            success: false,
            error: "AI failed to generate SQL commands",
            explanation: "The AI system encountered an error while generating SQL commands.",
            sqlQuery: null,
          };
        }
      } else {
        return {
          success: false,
          error: "AI failed to generate SQL commands",
          explanation: "The AI system encountered an error while generating SQL commands.",
          sqlQuery: null,
        };
      }
    }

    // Step 5: Return the commands for sequential execution
    return {
      success: true,
      sqlCommands,
      sqlQuery: null,
      executionResult: null,
    };
  } catch (error) {
    console.error("AI Agent Error:", error);
    return {
      success: false,
      error: "AI agent failed to process request",
      explanation: error instanceof Error ? error.message : "Unknown error occurred",
      sqlQuery: null,
    };
  }
}