import { NextRequest, NextResponse } from 'next/server'
import { generateSQLFromPrompt, PromptHistoryItem } from '@/lib/ai-sql-generator'

export async function POST(request: NextRequest) {
  try {
    const { username, prompt, history, previousError, previousQuery } = await request.json() as {
      username: string;
      prompt: string;
      history?: PromptHistoryItem[];
      previousError?: string;
      previousQuery?: string;
    }

    if (!username || !prompt) {
      return NextResponse.json(
        { success: false, error: 'Username and prompt are required' },
        { status: 400 }
      )
    }

    // History and error context are optional, so they might be undefined
    const result = await generateSQLFromPrompt(username, prompt, history, previousError, previousQuery)
    
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
