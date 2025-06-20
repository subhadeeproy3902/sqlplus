import { NextRequest, NextResponse } from 'next/server'
import { generateSQLFromPrompt, PromptHistoryItem } from '@/lib/ai-sql-generator'

export async function POST(request: NextRequest) {
  try {
    const { username, prompt, history } = await request.json() as {
      username: string;
      prompt: string;
      history?: PromptHistoryItem[];
    }

    if (!username || !prompt) {
      return NextResponse.json(
        { success: false, error: 'Username and prompt are required' },
        { status: 400 }
      )
    }

    // History is optional, so it might be undefined
    const result = await generateSQLFromPrompt(username, prompt, history)
    
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
