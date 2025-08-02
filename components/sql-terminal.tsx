'use client'

import { useState, useEffect, useRef, KeyboardEvent } from 'react'
import { formatQueryResult } from '@/lib/sql-executor'
import { isAICommand, extractAIPrompt } from '@/lib/ai-sql-generator'
import { ThemeToggle } from './theme-toggle'
import HelpModal from './Helpmodal'
import Loader from './Loader'

interface TerminalLine {
  type: 'output' | 'input' | 'error' | 'success'
  content: string
  timestamp?: Date
  isLoader?: boolean
  loaderMessage?: string
}

interface AuthState {
  isAuthenticated: boolean
  username: string | null
  isRegistering: boolean
}

interface HistoryItem {
  fullCommand: string
  lastLine: string
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
  const [commandHistory, setCommandHistory] = useState<HistoryItem[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [showingFullCommand, setShowingFullCommand] = useState(false)
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    username: null,
    isRegistering: false
  })
  const [authStep, setAuthStep] = useState<'ask' | 'username' | 'password'>('ask')
  const [tempUsername, setTempUsername] = useState('')
  const [isPasswordInput, setIsPasswordInput] = useState(false)
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false); // State for HelpModal
  const [currentLineNumber, setCurrentLineNumber] = useState(1); // For auto-numbering
  const [isLoading, setIsLoading] = useState(false); // Loading state for API calls
  const [isExecutingSQL, setIsExecutingSQL] = useState(false); // Loading state for SQL execution
  
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
      // Only add welcome message if there are no existing lines or if the last line is not the welcome message
      const lastLine = lines[lines.length - 1]
      if (!lastLine || lastLine.content !== 'Welcome! Type LOGIN to sign in or REGISTER to create an account.') {
        addLine('output', 'Welcome! Type LOGIN to sign in or REGISTER to create an account.')
      }
    }
  }, [authState.isAuthenticated, authStep, lines])

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
          // Shift+Enter: always add a newline, but without auto-numbering for simplicity,
          // or decide if numbering should continue/reset here. For now, just newline.
          setCurrentInput(prev => prev + '\n');
        } else {
          // Enter alone:
          const isSpecialCommand = ['exit', 'quit', 'clear scr', 'clear screen', 'help', 'show tables'].includes(trimmedInput.toLowerCase());
          if (trimmedInput.endsWith(';') || isSpecialCommand) {
            // Command is complete, execute it
            handleCommand();
            // currentLineNumber will be reset in handleCommand
          } else {
            // Command is not complete, start or continue auto-numbering
            if (currentInput.trim()) { // Only add numbering if there's content
              const nextLineNum = currentLineNumber + 1;
              setCurrentInput(prevInput => `${prevInput}\n${nextLineNum}) `);
              setCurrentLineNumber(nextLineNum);
            }
          }
        }
        return; // Exclusive action for Enter when authenticated
      }
    }

    // Command History (ArrowUp/ArrowDown) - Always active for better UX
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0 && historyIndex < commandHistory.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        const historyItem = commandHistory[commandHistory.length - 1 - newIndex];
        // For authenticated users (SQL mode), show only the last line initially
        // For unauthenticated users, show the full command
        if (authState.isAuthenticated) {
          setCurrentInput(historyItem.lastLine);
          setShowingFullCommand(false);
        } else {
          setCurrentInput(historyItem.fullCommand);
        }
        // Focus and select all text for immediate replacement
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
          }
        }, 0);
      } else if (authState.isAuthenticated && historyIndex >= 0 && !showingFullCommand) {
        // If already at the latest history item and in SQL mode, toggle to show full command
        const historyItem = commandHistory[commandHistory.length - 1 - historyIndex];
        if (historyItem.fullCommand !== historyItem.lastLine) {
          setCurrentInput(historyItem.fullCommand);
          setShowingFullCommand(true);
          // Focus and select all text for immediate replacement
          setTimeout(() => {
            if (inputRef.current) {
              inputRef.current.focus();
              inputRef.current.select();
            }
          }, 0);
        }
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (showingFullCommand && authState.isAuthenticated) {
        // If showing full command, go back to last line
        const historyItem = commandHistory[commandHistory.length - 1 - historyIndex];
        setCurrentInput(historyItem.lastLine);
        setShowingFullCommand(false);
        // Focus and select all text for immediate replacement
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
          }
        }, 0);
      } else if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        const historyItem = commandHistory[commandHistory.length - 1 - newIndex];
        // For authenticated users (SQL mode), show only the last line
        // For unauthenticated users, show the full command
        if (authState.isAuthenticated) {
          setCurrentInput(historyItem.lastLine);
          setShowingFullCommand(false);
        } else {
          setCurrentInput(historyItem.fullCommand);
        }
        // Focus and select all text for immediate replacement
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
          }
        }, 0);
      } else if (historyIndex === 0) { // Was at the first history item, now going "down" to empty
        setHistoryIndex(-1);
        setCurrentInput('');
        setShowingFullCommand(false);
        // Focus the input
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
          }
        }, 0);
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
    setShowingFullCommand(false); // Reset full command state
    if (inputRef.current) { // Reset height after command submission
        inputRef.current.style.height = 'auto';
    }
    setCurrentLineNumber(1); // Reset line number after command execution
    
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
    setIsLoading(true)
    // Add loader instead of text
    setLines(prevLines => [...prevLines, { type: 'output', content: '', isLoader: true, loaderMessage: 'Connecting...' }])

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })

      const result = await response.json()

      // Remove loader
      setLines(prevLines => prevLines.filter(line => !line.isLoader))

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
      // Remove loader
      setLines(prevLines => prevLines.filter(line => !line.isLoader))
      addLine('error', 'Connection failed')
      resetAuth()
    } finally {
      setIsLoading(false)
    }
  }

  const handleRegister = async (username: string, password: string) => {
    setIsLoading(true)
    // Add loader instead of text
    setLines(prevLines => [...prevLines, { type: 'output', content: '', isLoader: true, loaderMessage: 'Creating account...' }])

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })

      const result = await response.json()

      // Remove loader
      setLines(prevLines => prevLines.filter(line => !line.isLoader))

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
      // Remove loader
      setLines(prevLines => prevLines.filter(line => !line.isLoader))
      addLine('error', 'Account creation failed')
      resetAuth()
    } finally {
      setIsLoading(false)
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
    // Welcome message will be added by useEffect when authStep changes to 'ask'
  }

  const handleSQLCommand = async (input: string) => {
    // Clean the input to remove line numbers like "2) ", "3) " etc.
    // from the start of lines (except the first line).
    const lines = input.split('\n');
    const cleanedInput = lines.map((line, index) => {
      if (index === 0) {
        return line; // Keep the first line as is
      }
      // For subsequent lines, remove the "N) " pattern
      // Regex matches: start of line, 1+ digits, a closing parenthesis, and a space.
      return line.replace(/^\d+\)\s/, '');
    }).join('\n');

    // Add to command history (only for SQL commands)
    // Use the cleanedInput for history to store the executable version
    if (cleanedInput && !commandHistory.some(item => item.fullCommand === cleanedInput)) {
      // Extract the last line for history navigation
      const lines = cleanedInput.split('\n');
      const lastLine = lines[lines.length - 1].trim();

      setCommandHistory(prev => [...prev, {
        fullCommand: cleanedInput,
        lastLine: lastLine || cleanedInput // Fallback to full command if last line is empty
      }]);
    }

    // Handle special commands using the original input for commands like "clear scr"
    // as they might not have line numbers and cleaning might be irrelevant.
    // However, for consistency and to avoid issues if they somehow get numbered,
    // it's safer to use cleanedInput for command checks too, or be very specific.
    // For now, using 'input.toLowerCase()' for special commands as they are less likely to be multi-lined with numbers.
    // Let's reconsider this: Special commands should also operate on the cleaned version
    // if they were part of a multi-line entry that got numbered.
    const commandToCheck = cleanedInput.trim().toLowerCase(); // Use cleaned and trimmed for command checks

    if (commandToCheck === 'clear scr' || commandToCheck === 'clear screen') {
      setLines([]);
      return;
    }

    if (commandToCheck === 'show tables') {
      // Execute a query to show user's tables using pg_tables
      const currentUserName = (authState.username || '').replace(/[^a-zA-Z0-9_]/g, '_');
      const showTablesQuery = `
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = '${currentUserName}'
        ORDER BY tablename
      `;

      setIsExecutingSQL(true)
      setLines(prevLines => [...prevLines, { type: 'output', content: '', isLoader: true, loaderMessage: 'Getting your tables...' }])

      try {
        const response = await fetch('/api/sql/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: authState.username,
            query: showTablesQuery
          })
        })

        const result = await response.json()

        // Remove loader
        setLines(prevLines => prevLines.filter(line => !line.isLoader))

        const formattedResult = formatQueryResult(result)

        if (result.success) {
          addLine('output', await formattedResult)
        } else {
          addLine('error', await formattedResult)
        }

        addLine('output', '')
      } catch (error) {
        setLines(prevLines => prevLines.filter(line => !line.isLoader))
        addLine('error', 'ERROR: Failed to get tables')
        addLine('output', '')
      } finally {
        setIsExecutingSQL(false)
      }
      return;
    }

    if (commandToCheck === 'exit' || commandToCheck === 'quit') {
      addLine('output', 'Disconnected from Oracle Database 21c Express Edition Release 21.0.0.0.0 - Production');
      setAuthState({
        isAuthenticated: false,
        username: null,
        isRegistering: false
      });
      setAuthStep('ask');
      addLine('output', '');
      // Welcome message will be added by useEffect when authStep changes to 'ask'
      return;
    }

    if (commandToCheck === 'help') {
      // The existing help text added via addLine can remain as a quick reference
      addLine('output', 'Available commands:');
      addLine('output', '  SQL commands - Execute any SQL query');
      addLine('output', '  /ai <prompt> - Generate and execute SQL using AI');
      addLine('output', '  clear scr - Clear the screen');
      addLine('output', '  help - Show this help message (also opens detailed help)');
      addLine('output', '  exit - Disconnect and logout');
      addLine('output', '');
      addLine('output', 'AI Examples:');
      addLine('output', '  /ai show me all tables');
      addLine('output', '  /ai create a users table with id and name');
      addLine('output', '  /ai find all records where name contains John');
      addLine('output', '');
      addLine('output', 'Quick commands:');
      addLine('output', '  SHOW TABLES - Show all your tables');
      addLine('output', '');
      // Now also open the modal:
      setIsHelpModalOpen(true);
      return; // Prevent further processing of "help" as a SQL query
    }

    if (!cleanedInput.trim()) { // Check if cleanedInput is empty
      return;
    }

    // Handle AI commands using cleanedInput
    if (isAICommand(cleanedInput)) {
      await handleAICommand(cleanedInput);
      return;
    }

    // Execute the SQL query
    setIsExecutingSQL(true)
    // Add loader instead of text
    setLines(prevLines => [...prevLines, { type: 'output', content: '', isLoader: true, loaderMessage: 'Executing query...' }])

    try {
      const response = await fetch('/api/sql/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: authState.username,
          query: cleanedInput // Use the cleaned SQL query
        })
      })

      const result = await response.json()

      // Remove loader
      setLines(prevLines => prevLines.filter(line => !line.isLoader))

      const formattedResult = formatQueryResult(result)

      if (result.success) {
        addLine('output', await formattedResult)
      } else {
        addLine('error', await formattedResult)
      }

      addLine('output', '')
    } catch (error) {
      // Remove loader
      setLines(prevLines => prevLines.filter(line => !line.isLoader))
      addLine('error', 'ERROR: Failed to execute query')
      addLine('output', '')
    } finally {
      setIsExecutingSQL(false)
    }
  }

  const handleAICommand = async (input: string, retryContext?: { originalPrompt: string, previousError: string, previousQuery: string, retryCount: number }) => {
    const prompt = retryContext ? retryContext.originalPrompt : extractAIPrompt(input)

    if (!prompt) {
      addLine('error', 'Please provide a prompt after /ai command. Example: /ai show me all users')
      addLine('output', '')
      return
    }

    const isRetry = !!retryContext
    const retryCount = retryContext?.retryCount || 0
    const maxRetries = 2

    // Only show initial message for first attempt, not retries
    if (!isRetry) {
      addLine('output', `🤖 Generating SQL for: "${prompt}"`)
      addLine('output', '')
      // Add loader component instead of text
      setLines(prevLines => [...prevLines, { type: 'output', content: '', isLoader: true, loaderMessage: 'Generating SQL...' }])
    }

    try {
      // Use the new agentic AI system for first attempt, fallback for retries
      const endpoint = isRetry ? '/api/ai/generate-sql' : '/api/ai/agent'

      const requestBody: any = {
        username: authState.username,
        prompt
      }

      if (retryContext) {
        requestBody.previousError = retryContext.previousError
        requestBody.previousQuery = retryContext.previousQuery
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })

      const result = await response.json()

      if (result.success && result.sqlQuery) {
        // Remove loader if it exists (only for first attempt)
        if (!isRetry) {
          setLines(prevLines => prevLines.filter(line => !line.isLoader))
        }

        // Show generated SQL for first attempt
        if (!isRetry) {
          addLine('success', `Generated SQL: ${result.sqlQuery}`)
          addLine('output', '')
        }

        // For agent response, execution result is already included
        let executeResult
        if (result.executionResult) {
          // Agent already executed the query
          executeResult = result.executionResult
          // Remove any remaining loaders
          setLines(prevLines => prevLines.filter(line => !line.isLoader))
        } else {
          // Fallback: execute manually (for retry cases)
          if (!isRetry) {
            setLines(prevLines => [...prevLines, { type: 'output', content: '', isLoader: true, loaderMessage: 'Executing query...' }])
          }

          const executeResponse = await fetch('/api/sql/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: authState.username,
              query: result.sqlQuery
            })
          })

          executeResult = await executeResponse.json()
          // Remove execution loader
          setLines(prevLines => prevLines.filter(line => !line.isLoader))
        }

        const formattedResult = formatQueryResult(executeResult)

        if (executeResult.success) {
          addLine('output', await formattedResult)
          if (isRetry) {
            addLine('success', `✅ Query executed successfully after ${retryCount} ${retryCount === 1 ? 'retry' : 'retries'}!`)
          }
        } else {
          // If execution failed and we haven't exceeded max retries, try again silently
          if (retryCount < maxRetries) {
            // Retry with error context without showing intermediate messages
            await handleAICommand(input, {
              originalPrompt: prompt,
              previousError: executeResult.error || 'Unknown database error',
              previousQuery: result.sqlQuery,
              retryCount: retryCount + 1
            })
            return
          } else {
            // Final failure after all retries
            addLine('error', await formattedResult)
            addLine('error', `❌ Failed to generate working query after ${maxRetries} retries.`)
            addLine('output', 'Try rephrasing your request or check if the tables/columns exist.')
          }
        }
      } else {
        // Remove loader if it exists
        if (!isRetry) {
          setLines(prevLines => prevLines.filter(line => !line.isLoader))
        }

        // If agent failed and this is the first attempt, try the fallback silently
        if (!isRetry) {
          try {
            const fallbackResponse = await fetch('/api/ai/generate-sql', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                username: authState.username,
                prompt
              })
            })

            const fallbackResult = await fallbackResponse.json()

            if (fallbackResult.success && fallbackResult.sqlQuery) {
              addLine('success', `Generated SQL: ${fallbackResult.sqlQuery}`)
              addLine('output', '')
              setLines(prevLines => [...prevLines, { type: 'output', content: '', isLoader: true, loaderMessage: 'Executing query...' }])

              const executeResponse = await fetch('/api/sql/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  username: authState.username,
                  query: fallbackResult.sqlQuery
                })
              })

              const executeResult = await executeResponse.json()
              setLines(prevLines => prevLines.filter(line => !line.isLoader))
              const formattedResult = formatQueryResult(executeResult)

              if (executeResult.success) {
                addLine('output', await formattedResult)
              } else {
                addLine('error', await formattedResult)
              }
            } else {
              addLine('error', `AI Error: ${result.error || 'Failed to generate SQL'}`)
            }
          } catch (fallbackError) {
            addLine('error', `AI Error: ${result.error || 'Failed to generate SQL'}`)
          }
        } else {
          addLine('error', `AI Error: ${result.error || 'Failed to generate SQL'}`)
        }
      }

      addLine('output', '')
    } catch (error) {
      // Remove loader if it exists
      setLines(prevLines => prevLines.filter(line => !line.isLoader))
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
        className="flex-1 overflow-y-auto p-2 space-y-1 terminal-output" // Reduced padding, added terminal-output class
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
              {line.isLoader ? (
                <Loader message={line.loaderMessage} />
              ) : (
                line.content
              )}
            </div>
          );
        })}
        {/* Input area styling: Added px-2 pb-2 pt-1 and items-start - Only show when not loading */}
        {!isLoading && !isExecutingSQL && !lines.some(line => line.isLoader) && (
          <div className="flex items-start text-black dark:text-white px-2 pb-2 pt-1">
            <span className="text-black dark:text-white">{getPrompt()}</span>
            {/* Replaced input with textarea */}
            <textarea
            ref={inputRef}
            rows={1}
            value={currentInput}
            onChange={(e) => setCurrentInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading || isExecutingSQL}
            className={`bg-transparent border-none outline-none flex-1 text-black dark:text-white caret-black dark:caret-white resize-none overflow-y-hidden font-mono ${(isLoading || isExecutingSQL) ? 'opacity-50 cursor-not-allowed' : ''}`}
            autoComplete="off"
            spellCheck={false}
            style={isPasswordInput ? {
              WebkitTextSecurity: 'disc',
              fontFamily: 'monospace' // Ensure monospace for consistent masking char width
            } : {
              fontFamily: 'monospace' // Keep font consistent
            }}
            // type attribute is not valid for textarea, password masking will be handled by isPasswordInput state if needed elsewhere
            // For the textarea itself, it doesn't support type="password".
            // This is a limitation if we need to keep textarea + password masking.
            // For now, following subtask to change to textarea. Password masking in display (lines) is separate.
          />
          {(isLoading || isExecutingSQL) ? (
            <span className="animate-spin text-black dark:text-white">⟳</span>
          ) : (
            <span className="animate-pulse text-black dark:text-white">█</span>
          )}
          </div>
        )}
      </div>
    </div>
  )
}