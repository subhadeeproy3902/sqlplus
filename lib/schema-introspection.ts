"use server"

import "dotenv/config"
import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
console.log(url) // For debugging purposes, remove in production
if (!url) {
  throw new Error('DATABASE_URL must be set')
}
const sql = neon(url)

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
    const setPathTemplate = Object.assign([`SET search_path TO "${schemaName}"`], { raw: [`SET search_path TO "${schemaName}"`] })
    await sql(setPathTemplate as TemplateStringsArray)
    
    // Get all tables in the user's schema
    const tablesQuery = Object.assign([`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = '${schemaName}'
      ORDER BY tablename
    `], { raw: [`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = '${schemaName}'
      ORDER BY tablename
    `] })
    
    const tablesResult = await sql(tablesQuery as TemplateStringsArray)
    const tables = Array.isArray(tablesResult) ? tablesResult : []
    
    const tableInfos: TableInfo[] = []
    
    for (const table of tables) {
      const tableName = table.tablename
      
      // Get column information
      const columnsQuery = Object.assign([`
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
      `], { raw: [`
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
      `] })
      
      const columnsResult = await sql(columnsQuery as TemplateStringsArray)
      const columns = Array.isArray(columnsResult) ? columnsResult : []
      
      const columnInfos: ColumnInfo[] = columns.map(col => ({
        columnName: col.column_name,
        dataType: col.data_type,
        isNullable: col.is_nullable === 'YES',
        defaultValue: col.column_default,
        isPrimaryKey: col.is_primary_key
      }))
      
      // Get sample data (first 3 rows)
      let sampleData: Record<string, any>[] = []
      try {
        const sampleQuery = Object.assign([`SELECT * FROM "${tableName}" LIMIT 3`], { raw: [`SELECT * FROM "${tableName}" LIMIT 3`] })
        const sampleResult = await sql(sampleQuery as TemplateStringsArray)
        sampleData = Array.isArray(sampleResult) ? sampleResult : []
      } catch (error) {
        // If we can't get sample data, that's okay
        console.warn(`Could not get sample data for table ${tableName}:`, error)
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
      schemaDescription += `Sample data (${table.sampleData.length} rows):\n`
      for (const row of table.sampleData) {
        schemaDescription += `  ${JSON.stringify(row)}\n`
      }
    }
    
    schemaDescription += '\n'
  }
  
  return schemaDescription
}
