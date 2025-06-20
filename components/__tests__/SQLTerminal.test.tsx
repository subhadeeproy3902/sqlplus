import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SQLTerminal from '../sql-terminal'; // Adjust path as needed

// Mock fetch
global.fetch = jest.fn();

// Mock next/font
jest.mock('next/font/google', () => ({
  GeistMono: () => ({
    style: {
      fontFamily: 'geist-mono',
    },
    className: 'geist-mono-class', // Add className property
  }),
}));


// Helper function to simulate successful login
async function simulateLogin(user: ReturnType<typeof userEvent.setup>) {
  const textbox = screen.getByRole('textbox');

  // Mock fetch for login steps
  (fetch as jest.Mock)
    .mockResolvedValueOnce({ // For LOGIN command (if it makes a call, otherwise not needed)
      ok: true,
      json: async () => ({ success: true }),
    })
    .mockResolvedValueOnce({ // For username (if it makes a call)
      ok: true,
      json: async () => ({ success: true }),
    })
    .mockResolvedValueOnce({ // For password (actual login call)
      ok: true,
      json: async () => ({ success: true, username: 'testuser' }),
    });

  // Type LOGIN
  await user.type(textbox, 'login');
  await user.keyboard('{Enter}');

  // Wait for prompt change if any, e.g., "Enter user-name:"
  // Depending on implementation, direct typing might be fine.
  // For this setup, we assume direct typing into the same textbox after prompts appear as lines.

  // Type username
  // Need to find the "Enter user-name:" prompt text to ensure we are at the right step.
  // The prompt is added as a line, not directly in the textbox.
  // The textbox should be clear for the next input.
  await waitFor(() => {
    expect(screen.getByText(/Enter user-name:/i)).toBeInTheDocument();
  });
  await user.type(textbox, 'testuser');
  await user.keyboard('{Enter}');

  // Type password
  await waitFor(() => {
    expect(screen.getByText(/Enter password:/i)).toBeInTheDocument();
  });
  await user.type(textbox, 'password123');
  await user.keyboard('{Enter}');

  // Wait for login success messages
  await waitFor(() => {
    expect(screen.getByText(/Connected to:/i)).toBeInTheDocument();
  });
}

describe('SQLTerminal Auto-Numbering', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
    // Reset fetch mock before each test in this suite if needed
    (fetch as jest.Mock).mockReset();
  });

  test('should add line numbers on Enter for incomplete multi-line commands when authenticated', async () => {
    render(<SQLTerminal />);
    await simulateLogin(user); // Ensure user is authenticated

    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;

    await user.type(textbox, 'CREATE TABLE test');
    await user.keyboard('{Enter}');
    expect(textbox.value).toBe('CREATE TABLE test\n2) ');

    await user.type(textbox, 'name VARCHAR(255)');
    await user.keyboard('{Enter}');
    expect(textbox.value).toBe('CREATE TABLE test\n2) name VARCHAR(255)\n3) ');
  });

  test('should not add line numbers on Shift+Enter when authenticated', async () => {
    render(<SQLTerminal />);
    await simulateLogin(user);

    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;

    await user.type(textbox, 'SELECT *');
    await user.keyboard('{Shift>}{Enter}{/Shift}'); // Press Shift+Enter
    expect(textbox.value).toBe('SELECT *\n');

    await user.type(textbox, 'FROM users');
    expect(textbox.value).toBe('SELECT *\nFROM users');
  });

  test('should reset line numbering after command submission when authenticated', async () => {
    render(<SQLTerminal />);
    await simulateLogin(user);

    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;

    // Mock fetch for SQL command
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'Command executed' }),
    });

    // First command (incomplete, then completed by ';')
    await user.type(textbox, 'SELECT * FROM users');
    await user.keyboard('{Enter}');
    expect(textbox.value).toBe('SELECT * FROM users\n2) ');
    await user.type(textbox, 'WHERE id = 1;'); // Complete the command
    await user.keyboard('{Enter}'); // Submit

    // After submission, textbox should be empty (or just prompt if it worked that way)
    // And line numbering should be reset for the *next* multi-line command.
    await waitFor(() => expect(textbox.value).toBe(''));


    // Start a new multi-line command
    await user.type(textbox, 'NEW FIRST LINE');
    await user.keyboard('{Enter}');
    // Now it should be "NEW FIRST LINE\n2) "
    expect(textbox.value).toBe('NEW FIRST LINE\n2) ');
  });

  test('should not add line numbers when not authenticated', async () => {
    render(<SQLTerminal />);
    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;

    await user.type(textbox, 'some input');
    await user.keyboard('{Enter}');

    // In the non-authenticated state, Enter attempts to process auth (e.g. LOGIN/REGISTER)
    // The input will be cleared, and it definitely shouldn't add "\n2) "
    expect(textbox.value).not.toContain('\n2) ');
    // More robustly, check if the input was processed as an auth command
    // For example, if "some input" is invalid, an error line is added.
    // (fetch as jest.Mock).mockResolvedValueOnce(...); // if "some input" triggers a fetch
    await waitFor(() => {
        // Check for the "Invalid command" line or similar, depending on auth logic for invalid initial commands
        // This assumes "some input" is not "login" or "register"
        expect(screen.getByText(/Invalid command. Please type LOGIN or REGISTER./i)).toBeInTheDocument();
    });
    expect(textbox.value).toBe(''); // Textbox clears after auth attempt
  });
});

describe('SQLTerminal Password Masking', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
    (fetch as jest.Mock).mockReset();
  });

  test('should apply text security styles to textarea during password input', async () => {
    render(<SQLTerminal />);
    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;

    // Simulate auth flow up to password
    (fetch as jest.Mock) // Mock for potential "login" or "username" processing if they made calls
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });


    await user.type(textbox, 'login');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText(/Enter user-name:/i)).toBeInTheDocument());

    await user.type(textbox, 'testuser');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText(/Enter password:/i)).toBeInTheDocument());

    // Assert style for password masking
    // Need to use .toHaveStyle for checking computed styles due to dynamic application
    expect(textbox).toHaveStyle('text-security: disc');
    // Or, if WebkitTextSecurity is the primary one being set and test env supports it:
    // expect(textbox).toHaveStyle('-webkit-text-security: disc');
  });

  test('should display asterisks in command history for password input', async () => {
    render(<SQLTerminal />);
    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;

    // Mock fetch for full login sequence
    (fetch as jest.Mock)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) }) // login command (hypothetical)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) }) // username (hypothetical)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, username: 'testuser' }) }); // password an login success


    await user.type(textbox, 'login');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText(/Enter user-name:/i)).toBeInTheDocument());

    await user.type(textbox, 'testuser');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText(/Enter password:/i)).toBeInTheDocument());

    await user.type(textbox, 'password123');
    await user.keyboard('{Enter}');

    // Wait for login to complete and lines to be added
    await waitFor(() => {
      // The line added to history should be like "Enter password: ***********"
      // The actual prompt might vary, so we look for the asterisks.
      // The input line is added with getPrompt() + displayInput.
      // getPrompt() for password step is "Enter password: "
      // displayInput is '*' repeated.
      const passwordLine = screen.getByText((content, element) => {
        return element?.tagName.toLowerCase() === 'div' &&
               content.startsWith('Enter password: ') &&
               content.endsWith('***********'); // 11 asterisks for "password123"
      });
      expect(passwordLine).toBeInTheDocument();
    });
  });
});

describe('SQLTerminal Styling Classes', () => {
  test('should apply correct padding and scrollbar class to output area', () => {
    render(<SQLTerminal />);
    // The output area is the one that contains all the lines.
    // It's identified by the `terminal-output` class we added.
    // A more robust way would be to add a data-testid if possible.
    // For now, let's assume it's the parent of the initial welcome messages.
    const welcomeMessage = screen.getByText(/SQL\*Plus: Release/i);
    const outputArea = welcomeMessage.parentElement?.parentElement; // First parent is the line div, second is the scrollable area

    expect(outputArea).toHaveClass('p-2');
    expect(outputArea).toHaveClass('terminal-output');
    expect(outputArea).not.toHaveClass('p-4'); // Ensure old padding is removed
  });

  test('should apply correct padding to input area wrapper', () => {
    render(<SQLTerminal />);
    const promptElement = screen.getByText("SQL>", { exact: false }); // Prompt when authenticated, or other prompts
    const inputAreaWrapper = promptElement.parentElement;

    // These classes are for the default authenticated state.
    // If testing unauthenticated, the prompt is different and classes might be too.
    // This test is fine as a basic check.
    // The prompt text changes, so this test might be flaky if not authenticated first.
    // For simplicity, we'll assume default render which starts with "SQL>" or similar.
    // Let's refine to target the div that contains the textarea
    const textbox = screen.getByRole('textbox');
    const inputWrapper = textbox.parentElement;


    expect(inputWrapper).toHaveClass('px-2');
    expect(inputWrapper).toHaveClass('pb-2');
    expect(inputWrapper).toHaveClass('pt-1');
    expect(inputWrapper).toHaveClass('items-start');
  });
});

// Basic test to ensure the component renders without crashing
test('renders SQLTerminal component', () => {
  render(<SQLTerminal />);
  expect(screen.getByText(/SQL\*Plus: Release/i)).toBeInTheDocument();
});
