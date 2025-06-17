'use client'

import { useState, useEffect, useRef, KeyboardEvent } from 'react'
import { formatQueryResult } from '@/lib/sql-executor'
import { isAICommand, extractAIPrompt } from '@/lib/ai-sql-generator'
import { ThemeToggle } from './theme-toggle'

interface TerminalLine {
  type: 'output' | 'input' | 'error' | 'success'
  content: string
  timestamp?: Date
}

interface AuthState {
  isAuthenticated: boolean
  username: string | null
  isRegistering: boolean
}

export default function SQLTerminal() {
  const [lines, setLines] = useState<TerminalLine[]>([
    {
      type: 'output',
      content: 'SQL*Plus: Release 21.0.0.0.0 - Production on ' + new Date().toDateString(),
      timestamp: new Date()
    },
    {
      type: 'output',
      content: 'Version 21.3.0.0.0',
      timestamp: new Date()
    },
    {
      type: 'output',
      content: '',
      timestamp: new Date()
    },
    {
      type: 'output',
      content: 'Copyright (c) 1982, 2021, Oracle. All rights reserved.',
      timestamp: new Date()
    },
    {
      type: 'output',
      content: '',
      timestamp: new Date()
    }
  ])
  
  const [currentInput, setCurrentInput] = useState('')
  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    username: null,
    isRegistering: false
  })
  const [authStep, setAuthStep] = useState<'ask' | 'username' | 'password'>('ask')
  const [tempUsername, setTempUsername] = useState('')
  const [isPasswordInput, setIsPasswordInput] = useState(false)
  
  const inputRef = useRef<HTMLInputElement>(null)
  const terminalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [])

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [lines])

  useEffect(() => {
    if (!authState.isAuthenticated && authStep === 'ask') {
      addLine('output', 'Do you have an account? (y/n):')
    }
  }, [authState.isAuthenticated, authStep])

  const addLine = (type: TerminalLine['type'], content: string) => {
    setLines(prev => [...prev, { type, content, timestamp: new Date() }])
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleCommand()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (commandHistory.length > 0 && historyIndex < commandHistory.length - 1) {
        const newIndex = historyIndex + 1
        setHistoryIndex(newIndex)
        setCurrentInput(commandHistory[commandHistory.length - 1 - newIndex])
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1
        setHistoryIndex(newIndex)
        setCurrentInput(commandHistory[commandHistory.length - 1 - newIndex])
      } else if (historyIndex === 0) {
        setHistoryIndex(-1)
        setCurrentInput('')
      }
    }
  }

  const handleCommand = async () => {
    const input = currentInput.trim()
    
    // Add input to display (mask password)
    const displayInput = isPasswordInput ? '*'.repeat(input.length) : input
    addLine('input', `${getPrompt()}${displayInput}`)
    
    if (!authState.isAuthenticated) {
      await handleAuthFlow(input)
    } else {
      await handleSQLCommand(input)
    }
    
    setCurrentInput('')
    setHistoryIndex(-1)
  }

  const getPrompt = (): string => {
    if (!authState.isAuthenticated) {
      if (authStep === 'ask') return ''
      if (authStep === 'username') return 'Enter user-name: '
      if (authStep === 'password') return 'Enter password: '
    }
    return 'SQL> '
  }

  const handleAuthFlow = async (input: string) => {
    if (authStep === 'ask') {
      if (input.toLowerCase() === 'y' || input.toLowerCase() === 'yes') {
        setAuthStep('username')
        setIsPasswordInput(false)
        addLine('output', 'Enter user-name: ')
      } else if (input.toLowerCase() === 'n' || input.toLowerCase() === 'no') {
        setAuthState(prev => ({ ...prev, isRegistering: true }))
        setAuthStep('username')
        setIsPasswordInput(false)
        addLine('output', 'Enter user-name: ')
      } else {
        addLine('error', 'Please enter y (yes) or n (no)')
        addLine('output', 'Do you have an account? (y/n):')
      }
    } else if (authStep === 'username') {
      setTempUsername(input)
      setAuthStep('password')
      setIsPasswordInput(true)
      addLine('output', 'Enter password: ')
    } else if (authStep === 'password') {
      setIsPasswordInput(false)
      
      if (authState.isRegistering) {
        await handleRegister(tempUsername, input)
      } else {
        await handleLogin(tempUsername, input)
      }
    }
  }

  const handleLogin = async (username: string, password: string) => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      
      const result = await response.json()
      
      if (result.success) {
        setAuthState({
          isAuthenticated: true,
          username: result.username,
          isRegistering: false
        })
        addLine('success', `Last Successful login time: ${new Date().toLocaleString()}`)
        addLine('output', '')
        addLine('output', 'Connected to:')
        addLine('output', 'Oracle Database 21c Express Edition Release 21.0.0.0.0 - Production')
        addLine('output', 'Version 21.3.0.0.0')
        addLine('output', '')
      } else {
        addLine('error', 'ERROR:')
        addLine('error', `ORA-01005: ${result.message}`)
        addLine('output', '')
        resetAuth()
      }
    } catch (error) {
      addLine('error', 'Connection failed')
      resetAuth()
    }
  }

  const handleRegister = async (username: string, password: string) => {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      
      const result = await response.json()
      
      if (result.success) {
        setAuthState({
          isAuthenticated: true,
          username: result.username,
          isRegistering: false
        })
        addLine('success', `Account created for user: ${result.username}`)
        addLine('success', `Last Successful login time: ${new Date().toLocaleString()}`)
        addLine('output', '')
        addLine('output', 'Connected to:')
        addLine('output', 'Oracle Database 21c Express Edition Release 21.0.0.0.0 - Production')
        addLine('output', 'Version 21.3.0.0.0')
        addLine('output', '')
      } else {
        addLine('error', 'ERROR:')
        addLine('error', `ORA-00955: ${result.message}`)
        addLine('output', '')
        resetAuth()
      }
    } catch (error) {
      addLine('error', 'Account creation failed')
      resetAuth()
    }
  }

  const resetAuth = () => {
    setAuthStep('ask')
    setAuthState({
      isAuthenticated: false,
      username: null,
      isRegistering: false
    })
    setTempUsername('')
    addLine('output', 'Do you have an account? (y/n):')
  }

  const handleSQLCommand = async (input: string) => {
    // Add to command history (only for SQL commands)
    if (input && !commandHistory.includes(input)) {
      setCommandHistory(prev => [...prev, input])
    }

    // Handle special commands
    if (input.toLowerCase() === 'clear scr' || input.toLowerCase() === 'clear screen') {
      setLines([])
      return
    }

    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      addLine('output', 'Disconnected from Oracle Database 21c Express Edition Release 21.0.0.0.0 - Production')
      setAuthState({
        isAuthenticated: false,
        username: null,
        isRegistering: false
      })
      setAuthStep('ask')
      addLine('output', '')
      addLine('output', 'Do you have an account? (y/n):')
      return
    }

    if (input.toLowerCase() === 'help') {
      addLine('output', 'Available commands:')
      addLine('output', '  SQL commands - Execute any SQL query')
      addLine('output', '  /ai <prompt> - Generate and execute SQL using AI')
      addLine('output', '  clear scr - Clear the screen')
      addLine('output', '  help - Show this help message')
      addLine('output', '  exit - Disconnect and logout')
      addLine('output', '')
      addLine('output', 'AI Examples:')
      addLine('output', '  /ai show me all tables')
      addLine('output', '  /ai create a users table with id and name')
      addLine('output', '  /ai find all records where name contains John')
      addLine('output', '')
      return
    }

    if (!input) {
      return
    }

    // Handle AI commands
    if (isAICommand(input)) {
      await handleAICommand(input)
      return
    }

    try {
      const response = await fetch('/api/sql/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username: authState.username, 
          query: input 
        })
      })
      
      const result = await response.json()
      const formattedResult = formatQueryResult(result)
      
      if (result.success) {
        addLine('output', formattedResult)
      } else {
        addLine('error', formattedResult)
      }
      
      addLine('output', '')
    } catch (error) {
      addLine('error', 'ERROR: Failed to execute query')
      addLine('output', '')
    }
  }

  const handleAICommand = async (input: string) => {
    const prompt = extractAIPrompt(input)

    if (!prompt) {
      addLine('error', 'Please provide a prompt after /ai command. Example: /ai show me all users')
      addLine('output', '')
      return
    }

    addLine('output', `🤖 Generating SQL for: "${prompt}"`)
    addLine('output', '')

    try {
      const response = await fetch('/api/ai/generate-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: authState.username,
          prompt
        })
      })

      const result = await response.json()

      if (result.success && result.sqlQuery) {
        addLine('success', `Generated SQL: ${result.sqlQuery}`)
        addLine('output', '')
        addLine('output', 'Executing query...')
        addLine('output', '')

        // Execute the generated SQL
        const executeResponse = await fetch('/api/sql/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: authState.username,
            query: result.sqlQuery
          })
        })

        const executeResult = await executeResponse.json()
        const formattedResult = formatQueryResult(executeResult)

        if (executeResult.success) {
          addLine('output', formattedResult)
        } else {
          addLine('error', formattedResult)
        }
      } else {
        addLine('error', `AI Error: ${result.error || 'Failed to generate SQL'}`)
        if (result.explanation) {
          addLine('output', result.explanation)
        }
      }

      addLine('output', '')
    } catch (error) {
      addLine('error', 'ERROR: Failed to process AI command')
      addLine('output', '')
    }
  }

  return (
    <div className="h-screen bg-white dark:bg-black text-black dark:text-white font-mono text-sm overflow-hidden flex flex-col relative">
      <ThemeToggle />
      <div
        ref={terminalRef}
        className="flex-1 overflow-y-auto p-4 space-y-1"
      >
        {lines.map((line, index) => (
          <div
            key={index}
            className={`whitespace-pre-wrap ${
              line.type === 'error' ? 'text-red-400' :
              line.type === 'success' ? 'text-green-500' :
              line.type === 'input' ? 'text-black dark:text-white' : 'text-black dark:text-white'
            }`}
          >
            {line.content}
          </div>
        ))}
        <div className="flex items-center text-black dark:text-white">
          <span className="text-black dark:text-white">{getPrompt()}</span>
          <input
            ref={inputRef}
            type={isPasswordInput ? 'password' : 'text'}
            value={currentInput}
            onChange={(e) => setCurrentInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="bg-transparent border-none outline-none flex-1 text-black dark:text-white caret-black dark:caret-white"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="animate-pulse text-black dark:text-white">█</span>
        </div>
      </div>
    </div>
  )
}
