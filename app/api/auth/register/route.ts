import { NextRequest, NextResponse } from 'next/server'
import { registerUser } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json()

    if (!username || !password) {
      return NextResponse.json(
        { success: false, message: 'Username and password are required' },
        { status: 400 }
      )
    }

    // Basic validation
    if (username.length < 3) {
      return NextResponse.json(
        { success: false, message: 'Username must be at least 3 characters long' },
        { status: 400 }
      )
    }

    if (password.length < 6) {
      return NextResponse.json(
        { success: false, message: 'Password must be at least 6 characters long' },
        { status: 400 }
      )
    }

    // Check for valid username (alphanumeric and underscore only)
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return NextResponse.json(
        { success: false, message: 'Username can only contain letters, numbers, and underscores' },
        { status: 400 }
      )
    }

    const result = await registerUser(username, password)

    if (result.success) {
      return NextResponse.json(result, { status: 201 })
    } else {
      return NextResponse.json(result, { status: 400 })
    }
  } catch (error) {
    console.error('Register API error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}
