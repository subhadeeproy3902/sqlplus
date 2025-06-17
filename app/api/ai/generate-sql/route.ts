import { NextRequest, NextResponse } from 'next/server'
import { generateSQLFromPrompt } from '@/lib/ai-sql-generator'

export async function POST(request: NextRequest) {
  try {
    const { username, prompt } = await request.json()

    if (!username || !prompt) {
      return NextResponse.json(
        { success: false, error: 'Username and prompt are required' },
        { status: 400 }
      )
    }

    const result = await generateSQLFromPrompt(username, prompt)
    
    return NextResponse.json(result, { 
      status: result.success ? 200 : 400 
    })
  } catch (error) {
    console.error('AI SQL generation API error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
