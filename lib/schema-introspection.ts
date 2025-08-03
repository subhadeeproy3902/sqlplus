"use server"

import "dotenv/config"
import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
console.log(url) // For debugging purposes, remove in production
if (!url) {
  throw new Error('DATABASE_URL must be set')
}
const sql = neon(url)

// Helper function to execute dynamic SQL queries with the Neon serverless driver
async function executeDynamicSQL(query: string): Promise<any> {
  const templateArray = Object.assign([query], { raw: [query] }) as TemplateStringsArray
  return await sql(templateArray)
}

export interface TableInfo {
  tableName: string
  columns: ColumnInfo[]
  sampleData?: Record<string, any>[]
}

export interface ColumnInfo {
  columnName: string
  dataType: string
  isNullable: boolean
  defaultValue?: string
  isPrimaryKey: boolean
}

export interface SchemaInfo {
  tables: TableInfo[]
  totalTables: number
}

export async function getUserSchemaInfo(username: string): Promise<SchemaInfo> {
  try {
    const schemaName = username.replace(/[^a-zA-Z0-9_]/g, '_')
    
    // Set search path to user schema
    await executeDynamicSQL(`SET search_path TO "${schemaName}"`)

    // Get all tables in the user's schema
    const tablesResult = await executeDynamicSQL(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = '${schemaName}'
      ORDER BY tablename
    `)
    const tables = Array.isArray(tablesResult) ? tablesResult : []
    
    const tableInfos: TableInfo[] = []
    
    for (const table of tables) {
      const tableName = table.tablename
      
      // Get column information
      const columnsResult = await executeDynamicSQL(`
        SELECT
          c.column_name,
          c.data_type,
          c.is_nullable,
          c.column_default,
          CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
        FROM information_schema.columns c
        LEFT JOIN (
          SELECT ku.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage ku
            ON tc.constraint_name = ku.constraint_name
            AND tc.table_schema = ku.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = '${schemaName}'
            AND tc.table_name = '${tableName}'
        ) pk ON c.column_name = pk.column_name
        WHERE c.table_schema = '${schemaName}'
          AND c.table_name = '${tableName}'
        ORDER BY c.ordinal_position
      `)
      const columns = Array.isArray(columnsResult) ? columnsResult : []
      
      const columnInfos: ColumnInfo[] = columns.map(col => ({
        columnName: col.column_name,
        dataType: col.data_type,
        isNullable: col.is_nullable === 'YES',
        defaultValue: col.column_default,
        isPrimaryKey: col.is_primary_key
      }))
      
      // Get ALL data from the table using schema prefix (search_path doesn't persist)
      let sampleData: Record<string, any>[] = []
      try {
        const allDataResult = await executeDynamicSQL(`SELECT * FROM "${schemaName}"."${tableName}" ORDER BY 1`)
        sampleData = Array.isArray(allDataResult) ? allDataResult : []
        console.log(`Retrieved ${sampleData.length} rows from table ${schemaName}.${tableName}`)
        console.log(`Sample data:`, sampleData)
      } catch (error) {
        // If we can't get data, that's okay
        console.warn(`Could not get data for table ${schemaName}.${tableName}:`, error)
      }
      
      tableInfos.push({
        tableName,
        columns: columnInfos,
        sampleData
      })
    }
    
    return {
      tables: tableInfos,
      totalTables: tableInfos.length
    }
  } catch (error) {
    console.error('Schema introspection error:', error)
    return {
      tables: [],
      totalTables: 0
    }
  }
}

export async function formatSchemaForAI(schemaInfo: SchemaInfo): Promise<string> {
  if (schemaInfo.totalTables === 0) {
    return "No tables found in the user's schema. The user needs to create tables first."
  }
  
  let schemaDescription = `Database Schema (${schemaInfo.totalTables} tables):\n\n`
  
  for (const table of schemaInfo.tables) {
    schemaDescription += `Table: ${table.tableName}\n`
    schemaDescription += `Columns:\n`
    
    for (const column of table.columns) {
      const pkIndicator = column.isPrimaryKey ? ' (PRIMARY KEY)' : ''
      const nullableIndicator = column.isNullable ? ' (nullable)' : ' (not null)'
      const defaultIndicator = column.defaultValue ? ` (default: ${column.defaultValue})` : ''
      
      schemaDescription += `  - ${column.columnName}: ${column.dataType}${pkIndicator}${nullableIndicator}${defaultIndicator}\n`
    }
    
    if (table.sampleData && table.sampleData.length > 0) {
      schemaDescription += `EXISTING DATA (${table.sampleData.length} rows):\n`

      // Show all data for small tables, or first 10 + last 5 for larger tables
      if (table.sampleData.length <= 15) {
        for (const row of table.sampleData) {
          schemaDescription += `  ${JSON.stringify(row)}\n`
        }
      } else {
        // Show first 10 rows
        for (let i = 0; i < 10; i++) {
          schemaDescription += `  ${JSON.stringify(table.sampleData[i])}\n`
        }
        schemaDescription += `  ... (${table.sampleData.length - 15} more rows) ...\n`
        // Show last 5 rows
        for (let i = table.sampleData.length - 5; i < table.sampleData.length; i++) {
          schemaDescription += `  ${JSON.stringify(table.sampleData[i])}\n`
        }
      }

      // Add critical information about primary key values
      const primaryKeyColumns = table.columns.filter(col => col.isPrimaryKey)
      if (primaryKeyColumns.length > 0) {
        const allPkValues = table.sampleData.map(row => {
          const pkData: Record<string, any> = {}
          primaryKeyColumns.forEach(pkCol => {
            pkData[pkCol.columnName] = row[pkCol.columnName]
          })
          return pkData
        })

        // Find the highest numeric primary key value
        const numericPkColumns = primaryKeyColumns.filter(col =>
          col.dataType.includes('int') || col.dataType.includes('serial')
        )

        if (numericPkColumns.length > 0) {
          const maxValues: Record<string, number> = {}
          numericPkColumns.forEach(pkCol => {
            const values = (table.sampleData ?? [])
              .map(row => parseInt(row[pkCol.columnName]))
              .filter(val => !isNaN(val))
            maxValues[pkCol.columnName] = values.length > 0 ? Math.max(...values) : 0
          })
          schemaDescription += `CRITICAL: Highest primary key values: ${JSON.stringify(maxValues)}\n`
          schemaDescription += `CRITICAL: Next available primary key values should start from: ${JSON.stringify(
            Object.fromEntries(Object.entries(maxValues).map(([key, val]) => [key, val + 1]))
          )}\n`
        }

        schemaDescription += `All primary key values in use: ${JSON.stringify(allPkValues)}\n`
      }
    } else {
      schemaDescription += `EXISTING DATA: Table is empty (0 rows)\n`
      schemaDescription += `CRITICAL: This is an empty table - primary keys should start from 1\n`
    }
    
    schemaDescription += '\n'
  }
  
  return schemaDescription
}
