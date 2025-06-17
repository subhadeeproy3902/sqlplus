import { NextRequest, NextResponse } from 'next/server'
import { executeUserQuery } from '@/lib/sql-executor'

export async function POST(request: NextRequest) {
  try {
    const { username, query } = await request.json()

    if (!username || !query) {
      return NextResponse.json(
        { success: false, error: 'Username and query are required' },
        { status: 400 }
      )
    }

    const result = await executeUserQuery(username, query)
    
    return NextResponse.json(result, { 
      status: result.success ? 200 : 400 
    })
  } catch (error) {
    console.error('SQL execution API error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
