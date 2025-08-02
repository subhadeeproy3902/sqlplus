import { NextRequest, NextResponse } from 'next/server'
import { generateSQLWithAgent } from '@/lib/ai-agent'

export async function POST(request: NextRequest) {
  try {
    const { username, prompt } = await request.json()

    if (!username || !prompt) {
      return NextResponse.json({
        success: false,
        error: 'Username and prompt are required'
      })
    }

    const result = await generateSQLWithAgent(username, prompt)

    return NextResponse.json(result)

  } catch (error) {
    console.error('AI Agent error:', error)
    return NextResponse.json({
      success: false,
      error: 'AI agent failed to process request',
      explanation: error instanceof Error ? error.message : 'Unknown error occurred'
    })
  }
}
