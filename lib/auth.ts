import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from './db'
import { User } from './schema'

export interface AuthResult {
  success: boolean
  message: string
  username?: string
}

export async function registerUser(username: string, password: string): Promise<AuthResult> {
  try {
    // Check if user already exists
    const existingUser = await db.select().from(User).where(eq(User.username, username)).limit(1)
    
    if (existingUser.length > 0) {
      return {
        success: false,
        message: 'Username already exists'
      }
    }

    // Hash password
    const saltRounds = 10
    const hashedPassword = await bcrypt.hash(password, saltRounds)

    // Create user
    await db.insert(User).values({
      username,
      password: hashedPassword
    })

    return {
      success: true,
      message: 'Account created successfully',
      username
    }
  } catch (error) {
    console.error('Registration error:', error)
    return {
      success: false,
      message: 'Failed to create account'
    }
  }
}

export async function loginUser(username: string, password: string): Promise<AuthResult> {
  try {
    // Find user
    const users = await db.select().from(User).where(eq(User.username, username)).limit(1)
    
    if (users.length === 0) {
      return {
        success: false,
        message: 'Invalid username or password'
      }
    }

    const user = users[0]

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password)
    
    if (!isValidPassword) {
      return {
        success: false,
        message: 'Invalid username or password'
      }
    }

    return {
      success: true,
      message: 'Login successful',
      username: user.username
    }
  } catch (error) {
    console.error('Login error:', error)
    return {
      success: false,
      message: 'Login failed'
    }
  }
}
