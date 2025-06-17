'use client'

import { useState, useEffect, useRef, KeyboardEvent } from 'react'
import { formatQueryResult } from '@/lib/sql-executor'
import { isAICommand, extractAIPrompt } from '@/lib/ai-sql-generator'
import { ThemeToggle } from './theme-toggle'
import HelpModal from './Helpmodal'

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
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false); // State for HelpModal
  
  const inputRef = useRef<HTMLTextAreaElement>(null) // Changed to HTMLTextAreaElement
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

  // Auto-grow textarea
  useEffect(() => {
    if (inputRef.current) {
      // Keep single line for all auth steps (when user is not authenticated)
      // or when specifically in password input mode (though this is covered by !authState.isAuthenticated)
      if (!authState.isAuthenticated) {
        inputRef.current.style.height = 'auto';
      } else { // Authenticated: auto-grow for SQL input
        inputRef.current.style.height = 'auto'; // Reset height to shrink if needed
        inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
      }
    }
  }, [currentInput, authState.isAuthenticated]); // Dependency on authState.isAuthenticated added

  useEffect(() => {
    if (!authState.isAuthenticated && authStep === 'ask') {
      // New:
      addLine('output', 'Welcome! Type LOGIN to sign in or REGISTER to create an account.')
    }
  }, [authState.isAuthenticated, authStep])

  const addLine = (type: TerminalLine['type'], content: string) => {
    setLines(prev => [...prev, { type, content, timestamp: new Date() }])
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+C for Cancellation (Global: works in auth and authenticated modes)
    if (e.ctrlKey && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'с')) {
      e.preventDefault();
      const promptText = getPrompt();
      // Display ^C, add to lines, clear input, and reset height.
      // Using currentInput directly for displayValue to show exactly what was "cancelled".
      const displayValue = isPasswordInput ? '*'.repeat(currentInput.length) : currentInput;
      addLine('input', `${promptText}${displayValue}^C`);

      setCurrentInput('');
      if (inputRef.current) {
        inputRef.current.style.height = 'auto'; // Reset height
      }
      // setHistoryIndex(-1); // Optionally reset history browsing on Ctrl+C
      return;
    }

    // Handle authentication flow (unauthenticated user) - strict single-line behavior
    if (!authState.isAuthenticated) {
      if (e.key === 'Enter' && !e.shiftKey) { // Simple Enter submits
        e.preventDefault();
        handleCommand();
      } else if (e.key === 'Tab' || (e.key === 'Enter' && e.shiftKey)) { // Disable Tab and Shift+Enter for newlines
        e.preventDefault();
      }
      // Allow default for other keys (alphanumeric, backspace).
      // History (ArrowUp/Down) will be handled by the common logic below if currentInput is empty.
      // No return here, so history check can proceed.
    } else {
      // --- Multiline logic for authenticated users (SQL input) ---
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = e.currentTarget.selectionStart;
        const end = e.currentTarget.selectionEnd;
        setCurrentInput(prev => `${prev.substring(0, start)}\t${prev.substring(end)}`);
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.selectionStart = inputRef.current.selectionEnd = start + 1;
          }
        }, 0);
        return; // Exclusive action for Tab when authenticated
      }

      if (e.key === 'Enter') {
        e.preventDefault(); // Always prevent default for Enter to manage manually
        const trimmedInput = currentInput.trim();
        if (e.shiftKey) {
          setCurrentInput(prev => prev + '\n'); // Shift+Enter adds newline
        } else {
          // Enter alone: execute if ends with semicolon or is a special command
          const isSpecialCommand = ['exit', 'quit', 'clear scr', 'clear screen', 'help'].includes(trimmedInput.toLowerCase());
          if (trimmedInput.endsWith(';') || isSpecialCommand) {
            handleCommand();
          } else {
            setCurrentInput(prev => prev + '\n'); // Otherwise, add newline
          }
        }
        return; // Exclusive action for Enter when authenticated
      }
    }

    // Command History (ArrowUp/ArrowDown) - Active if input is empty, regardless of auth state (after specific Enter/Tab handling)
    // This block is reached if not authenticated and key wasn't Enter/Tab/Shift+Enter,
    // OR if authenticated and key wasn't Tab/Enter.
    if (currentInput === '') {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (commandHistory.length > 0 && historyIndex < commandHistory.length - 1) {
          const newIndex = historyIndex + 1;
          setHistoryIndex(newIndex);
          setCurrentInput(commandHistory[commandHistory.length - 1 - newIndex]);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIndex > 0) {
          const newIndex = historyIndex - 1;
          setHistoryIndex(newIndex);
          setCurrentInput(commandHistory[commandHistory.length - 1 - newIndex]);
        } else if (historyIndex === 0) { // Was at the first history item, now going "down" to empty
          setHistoryIndex(-1);
          setCurrentInput('');
        }
      }
    }
    // Other keys (letters, numbers, backspace, etc.) will be handled natively by the textarea.
  }

  const handleCommand = async () => {
    // Use currentInput from state directly for processing, as it contains the full multiline text
    const inputToProcess = currentInput.trim();
    
    // For display, use the raw currentInput to preserve newlines before it's added to lines.
    // Mask if password.
    const displayInput = isPasswordInput ? '*'.repeat(currentInput.length) : currentInput;
    // Add the potentially multiline input to the history display.
    // The getPrompt() is added here to ensure it's part of the line.
    addLine('input', `${getPrompt()}${displayInput}`);

    // Clear input *immediately* after command is captured
    setCurrentInput('');
    setHistoryIndex(-1); // Reset history index as well
    if (inputRef.current) { // Reset height after command submission
        inputRef.current.style.height = 'auto';
    }
    
    // Process the command (which is already trimmed)
    if (!authState.isAuthenticated) {
      await handleAuthFlow(inputToProcess);
    } else {
      await handleSQLCommand(inputToProcess);
    }
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
    const command = input.toLowerCase().trim(); // Standardize input

    if (authStep === 'ask') {
      if (command === 'login') {
        setAuthState(prev => ({ ...prev, isRegistering: false }));
        setAuthStep('username');
        setIsPasswordInput(false);
        // No addLine here, getPrompt() will handle it for the input
      } else if (command === 'register') {
        setAuthState(prev => ({ ...prev, isRegistering: true }));
        setAuthStep('username');
        setIsPasswordInput(false);
        // No addLine here
      } else {
        addLine('error', "Invalid command. Please type LOGIN or REGISTER.");
      }
    } else if (authStep === 'username') {
      setTempUsername(command); // Use command (trimmed input)
      setAuthStep('password');
      setIsPasswordInput(true);
      // No addLine here for 'Enter password: '
    } else if (authStep === 'password') {
      setIsPasswordInput(false);
      // Note: 'input' here is the original, not 'command'. Passwords can be case-sensitive.
      // However, the original code used 'input' for setTempUsername, which is fine.
      // For handleRegister/handleLogin, it's 'input' from currentInput.trim()
      // which is then passed to handleAuthFlow. So, for password, it's the trimmed input.
      if (authState.isRegistering) {
        await handleRegister(tempUsername, input) // input here is the password
      } else {
        await handleLogin(tempUsername, input) // input here is the password
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
      isRegistering: false,
    });
    setTempUsername('');
    // New:
    addLine('output', 'Welcome! Type LOGIN to sign in or REGISTER to create an account.');
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
      // Update to the new standard auth prompt
      addLine('output', 'Welcome! Type LOGIN to sign in or REGISTER to create an account.');
      return
    }

    if (input.toLowerCase() === 'help') {
      // The existing help text added via addLine can remain as a quick reference
      addLine('output', 'Available commands:')
      addLine('output', '  SQL commands - Execute any SQL query')
      addLine('output', '  /ai <prompt> - Generate and execute SQL using AI')
      addLine('output', '  clear scr - Clear the screen')
      addLine('output', '  help - Show this help message (also opens detailed help)')
      addLine('output', '  exit - Disconnect and logout')
      addLine('output', '')
      addLine('output', 'AI Examples:')
      addLine('output', '  /ai show me all tables')
      addLine('output', '  /ai create a users table with id and name')
      addLine('output', '  /ai find all records where name contains John')
      addLine('output', '')
      // Now also open the modal:
      setIsHelpModalOpen(true);
      return; // Prevent further processing of "help" as a SQL query
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
        addLine('output', await formattedResult)
      } else {
        addLine('error', await formattedResult)
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
          addLine('output', await formattedResult)
        } else {
          addLine('error', await formattedResult)
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
      {/* Help Button */}
      <button
        onClick={() => setIsHelpModalOpen(true)}
        className="fixed top-4 right-16 z-50 p-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-black text-black dark:text-white hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
        aria-label="Open help modal"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
        </svg>
      </button>
      <HelpModal isOpen={isHelpModalOpen} onClose={() => setIsHelpModalOpen(false)} />

      <div
        ref={terminalRef}
        className="flex-1 overflow-y-auto p-4 space-y-1"
      >
        {lines.map((line, index) => {
          let specialColor = '';
          if (line.type === 'output' && line.content.startsWith('🤖 Generating SQL for:')) {
            specialColor = 'text-blue-400 dark:text-blue-300'; // Example: Blue for generating
          }
          // The "Generated SQL:" message is already handled by line.type === 'success'

          return (
            <div
              key={index}
              className={`whitespace-pre-wrap ${
                specialColor ? specialColor : // Apply special color if present
                line.type === 'error' ? 'text-red-500' :
                line.type === 'success' ? 'text-emerald-500' :
                'text-black dark:text-white' // Default for 'input' and 'output'
              }`}
            >
              {line.content}
            </div>
          );
        })}
        <div className="flex items-center text-black dark:text-white">
          <span className="text-black dark:text-white">{getPrompt()}</span>
          {/* Replaced input with textarea */}
          <textarea
            ref={inputRef}
            rows={1}
            value={currentInput}
            onChange={(e) => setCurrentInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="bg-transparent border-none outline-none flex-1 text-black dark:text-white caret-black dark:caret-white resize-none overflow-y-hidden font-mono"
            autoComplete="off"
            spellCheck={false}
            // type attribute is not valid for textarea, password masking will be handled by isPasswordInput state if needed elsewhere
            // For the textarea itself, it doesn't support type="password".
            // This means if isPasswordInput is true, the text will be visible in the textarea.
            // This is a limitation if we need to keep textarea + password masking.
            // For now, following subtask to change to textarea. Password masking in display (lines) is separate.
          />
          <span className="animate-pulse text-black dark:text-white">█</span>
        </div>
      </div>
    </div>
  )
}