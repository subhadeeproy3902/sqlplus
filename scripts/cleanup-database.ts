#!/usr/bin/env bun
/**
 * Database Cleanup Script
 * 
 * This script removes all users and their respective schemas and tables.
 * Use with extreme caution - this will delete ALL user data!
 * 
 * Usage: bun run scripts/cleanup-database.ts
 */

import "dotenv/config"
import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import { User } from "../lib/schema"

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL must be set')
}

const sql = neon(url)
const db = drizzle({ client: sql })

// Helper function to execute dynamic SQL queries with the Neon serverless driver
async function executeDynamicSQL(query: string): Promise<any> {
  const templateArray = Object.assign([query], { raw: [query] }) as TemplateStringsArray
  return await sql(templateArray)
}

async function cleanupDatabase() {
  try {
    console.log('🧹 Starting database cleanup...')
    
    // Get all users from the user table
    const users = await db.select().from(User)
    console.log(`Found ${users.length} users to clean up`)
    
    if (users.length === 0) {
      console.log('✅ No users found, nothing to clean up')
      return
    }
    
    // Ask for confirmation
    console.log('\n⚠️  WARNING: This will delete ALL user data!')
    console.log('Users to be deleted:')
    users.forEach(user => {
      const schemaName = user.username.replace(/[^a-zA-Z0-9_]/g, '_')
      console.log(`  - ${user.username} (schema: ${schemaName})`)
    })
    
    console.log('\nPress Ctrl+C to cancel, or wait 5 seconds to continue...')
    await new Promise(resolve => setTimeout(resolve, 5000))
    
    // Clean up each user's schema and data
    for (const user of users) {
      const schemaName = user.username.replace(/[^a-zA-Z0-9_]/g, '_')
      console.log(`\n🗑️  Cleaning up user: ${user.username} (schema: ${schemaName})`)
      
      try {
        // Drop the user's schema and all its contents
        const dropSchemaQuery = `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`
        await executeDynamicSQL(dropSchemaQuery)
        console.log(`   ✅ Dropped schema: ${schemaName}`)
        
        // Remove user from the user table
        await db.delete(User).where(eq(User.username, user.username))
        console.log(`   ✅ Removed user: ${user.username}`)
        
      } catch (error) {
        console.error(`   ❌ Error cleaning up user ${user.username}:`, error)
      }
    }
    
    // Clean up any orphaned schemas (schemas that don't have corresponding users)
    console.log('\n🔍 Checking for orphaned schemas...')
    
    try {
      const schemasQuery = `
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'public')
        AND schema_name ~ '^[a-zA-Z0-9_]+$'
      `
      const schemas = await executeDynamicSQL(schemasQuery)
      
      const userSchemas = users.map(user => user.username.replace(/[^a-zA-Z0-9_]/g, '_'))
      
      for (const schemaRow of schemas) {
        const schemaName = schemaRow.schema_name
        if (!userSchemas.includes(schemaName)) {
          console.log(`🗑️  Found orphaned schema: ${schemaName}`)
          try {
            const dropOrphanQuery = `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`
            await executeDynamicSQL(dropOrphanQuery)
            console.log(`   ✅ Dropped orphaned schema: ${schemaName}`)
          } catch (error) {
            console.error(`   ❌ Error dropping orphaned schema ${schemaName}:`, error)
          }
        }
      }
    } catch (error) {
      console.error('❌ Error checking for orphaned schemas:', error)
    }
    
    console.log('\n✅ Database cleanup completed!')
    console.log('All users, their schemas, and tables have been removed.')
    
  } catch (error) {
    console.error('❌ Database cleanup failed:', error)
    process.exit(1)
  }
}

// Import eq function for database operations
import { eq } from 'drizzle-orm'

// Run the cleanup
cleanupDatabase()
  .then(() => {
    console.log('\n🎉 Cleanup script finished successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n💥 Cleanup script failed:', error)
    process.exit(1)
  })
