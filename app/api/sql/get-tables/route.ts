import { NextRequest, NextResponse } from 'next/server'
import { executeUserQuery } from '@/lib/sql-executor'

export async function POST(request: NextRequest) {
  try {
    const { username } = await request.json()

    if (!username) {
      return NextResponse.json({
        success: false,
        error: 'Username is required'
      })
    }

    // Use the sanitized schema name for consistency
    const schemaName = username.replace(/[^a-zA-Z0-9_]/g, '_')

    // Get all tables in the user's schema using secure executeUserQuery
    const query = `
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = '${schemaName}'
      ORDER BY tablename
    `

    const result = await executeUserQuery(username, query)

    if (result.success && result.data) {
      const tables = result.data.map((row: any) => row.tablename)
      return NextResponse.json({
        success: true,
        tables
      })
    } else {
      return NextResponse.json({
        success: false,
        error: result.error || 'Failed to retrieve tables'
      })
    }

  } catch (error) {
    console.error('Get tables error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to retrieve tables'
    })
  }
}
