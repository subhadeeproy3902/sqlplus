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

    // Set search path and get tables
    await executeDynamicSQL(`SET search_path TO "${schemaName}"`);

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

// Main AI agent function
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

    if (tables.length === 0) {
      console.log("No tables found for user:", username);
      return {
        success: false,
        error: "No tables found in your schema. Please create some tables first.",
        explanation: "The AI agent could not find any tables in your database schema.",
        sqlQuery: null,
      };
    }

    // Step 2: Analyze which tables might be relevant - simplified approach
    let filteredRelevantTables: string[];

    // Simple keyword matching for table relevance
    const promptLowerCase = prompt.toLowerCase();
    filteredRelevantTables = tables.filter((table) => {
      const tableLower = table.toLowerCase();
      // Check if table name appears in prompt or if prompt contains common keywords
      return (
        promptLowerCase.includes(tableLower) ||
        promptLowerCase.includes("all") ||
        promptLowerCase.includes("show") ||
        promptLowerCase.includes("table")
      );
    });

    // If no specific tables found, use all tables (limited to 3 for performance)
    if (filteredRelevantTables.length === 0) {
      filteredRelevantTables = tables.slice(0, 3);
    } else {
      filteredRelevantTables = filteredRelevantTables.slice(0, 3);
    }

    // Step 3: Get schemas for relevant tables
    const tableSchemas = await Promise.all(
      filteredRelevantTables.map(async (tableName) => {
        const schema = await getTableSchema(username, tableName);
        return { tableName, schema };
      })
    );

    const validSchemas = tableSchemas.filter((item) => item.schema !== null);

    // Step 4: Generate SQL commands array with structured output
    let sqlCommands: string[] = [];

    try {
      // Generate SQL using AI - let PostgreSQL handle schema isolation naturally
      const result = await generateObject({
          model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
          temperature: 0.2,
          maxTokens: 4096,
          schema: z.object({
            commands: z.array(z.string()).optional(),
            sql_commands: z.array(z.string()).optional()
          }).transform((data) => ({
            commands: data.commands || data.sql_commands || []
          })),
          prompt: `You are a PostgreSQL assistant. Generate SQL commands for the user request.

USER REQUEST: "${prompt}"

AVAILABLE TABLES: ${filteredRelevantTables.join(", ")}

TABLE SCHEMAS:
${validSchemas.map(
  (item) => `
Table: ${item.tableName}
Columns: ${
    item.schema?.columns
      ?.map((col: any) => `${col.column_name} (${col.data_type})`)
      .join(", ") || "No columns found"
  }
`
).join("\n")}

RULES:
1. Generate SQL commands in this format: { "commands": ["SQL1;", "SQL2;"] }
2. For "show tables" requests, use: SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename;
3. For table schema requests, use: SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tablename' ORDER BY ordinal_position;
4. Only use the tables listed above: ${filteredRelevantTables.join(", ")}
5. Each command must end with semicolon
6. No explanations, just SQL commands
7. Use standard PostgreSQL syntax`
        });

      console.log("Generated commands:", result);
      const commandsResult = result.object as { commands: string[] };
      sqlCommands = commandsResult.commands;
    } catch (error) {
      console.error("Error in generateObject:", error);
      // Fallback to simple query if AI fails
      if (prompt.toLowerCase().includes("schema")) {
        const tableName = filteredRelevantTables[0];
        sqlCommands = [
          `SELECT column_name, data_type 
           FROM information_schema.columns 
           WHERE table_name = '${tableName}'`
        ];
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