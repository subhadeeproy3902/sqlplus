// components/HelpModal.tsx
'use client';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function HelpModal({ isOpen, onClose }: HelpModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 text-black dark:text-white p-6 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-semibold">Help & Tips</h2>
          <button
            onClick={onClose}
            className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white text-2xl"
            aria-label="Close help modal"
          >
            &times;
          </button>
        </div>
        
        <div className="space-y-4 text-sm">
          <section>
            <h3 className="text-lg font-medium mb-1 text-emerald-500">General Commands:</h3>
            <ul className="list-disc list-inside pl-2 space-y-1">
              <li><code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">SELECT ...;</code> - Execute any standard SQL query. End with a semicolon.</li>
              <li><code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">/ai &lt;your question&gt;</code> - Generate and execute SQL using AI. (e.g., <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">/ai show me all users</code>)</li>
              <li><code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">clear scr</code> or <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">clear screen</code> - Clear the terminal screen.</li>
              <li><code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">help</code> - Show this help message (alternative to button).</li>
              <li><code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">exit</code> or <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">quit</code> - Disconnect and logout.</li>
            </ul>
          </section>

          <section>
            <h3 className="text-lg font-medium mb-1 text-emerald-500">Multiline Input:</h3>
            <ul className="list-disc list-inside pl-2 space-y-1">
              <li>Type your SQL query across multiple lines.</li>
              <li>Press <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">Enter</code> to go to a new line (if not ending with <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">;</code>).</li>
              <li>Press <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">Shift + Enter</code> to force a new line.</li>
              <li>End your complete SQL command with a semicolon (<code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">;</code>) and then press <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">Enter</code> to execute.</li>
              <li>Press <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">Tab</code> to indent your code.</li>
              <li>Press <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">Ctrl + C</code> to cancel and clear your current multiline input. (Note: This is specifically Ctrl, not Cmd on Mac, for this custom interrupt).</li>
            </ul>
          </section>
          
          <section>
            <h3 className="text-lg font-medium mb-1 text-emerald-500">AI Query Tips:</h3>
            <ul className="list-disc list-inside pl-2 space-y-1">
              <li>Be specific in your requests. (e.g., &quot;show me all users with names starting with A&quot;)</li>
              <li>The AI knows your table structure. You can ask about columns and relationships.</li>
              <li>If the AI makes a mistake, try rephrasing your question.</li>
              <li>Example: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">/ai list all tables I can access</code></li>
              <li>Example: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">/ai create a table named &apos;products&apos; with columns: id (integer, primary key), name (text), price (numeric)</code></li>
            </ul>
          </section>

          <section>
            <h3 className="text-lg font-medium mb-1 text-emerald-500">Keyboard Shortcuts:</h3>
            <ul className="list-disc list-inside pl-2 space-y-1">
              <li><code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">ArrowUp</code> / <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">ArrowDown</code> (when input is empty) - Navigate command history.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
