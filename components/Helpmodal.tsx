"use client";

import { useRef, useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { HelpCircle } from "lucide-react";

export default function HelpModal() {
  const [hasReadToBottom, setHasReadToBottom] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    const content = contentRef.current;
    if (!content) return;
    const scrollPercentage =
      content.scrollTop / (content.scrollHeight - content.clientHeight);
    if (scrollPercentage >= 0.99 && !hasReadToBottom) {
      setHasReadToBottom(true);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          className="p-2 rounded-md border hover:bg-secondary transition-colors w-auto h-auto aspect-square fixed top-4 right-16 z-50 inline-flex items-center justify-center "
        >
          <HelpCircle className="w-5 h-5" />
        </button>
      </DialogTrigger>
      <DialogContent
        className="max-w-2xl max-h-[80vh] overflow-y-auto"
        onScroll={handleScroll}
        ref={contentRef}
      >
        <DialogHeader>
          <DialogTitle>Help & Tips</DialogTitle>
          <DialogDescription>
            Quick reference for commands, shortcuts, and AI query usage.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <section>
            <h3 className="text-lg font-medium mb-1 text-emerald-500">
              General Commands:
            </h3>
            <ul className="list-disc list-inside pl-2 space-y-1">
              <li>
                <code className="bg-secondary px-1 rounded">
                  SELECT ...;
                </code>{" "}
                - Execute SQL queries.
              </li>
              <li>
                <code className="bg-secondary px-1 rounded">
                  /ai &lt;your question&gt;
                </code>{" "}
                - Generate and execute SQL with AI.
              </li>
              <li>
                <code className="bg-secondary px-1 rounded">
                  clear scr
                </code>{" "}
                /{" "}
                <code className="bg-secondary px-1 rounded">
                  clear screen
                </code>{" "}
                - Clear terminal.
              </li>
              <li>
                <code className="bg-secondary px-1 rounded">
                  help
                </code>{" "}
                - Show help.
              </li>
              <li>
                <code className="bg-secondary px-1 rounded">
                  exit
                </code>{" "}
                /{" "}
                <code className="bg-secondary px-1 rounded">
                  quit
                </code>{" "}
                - Disconnect and logout.
              </li>
            </ul>
          </section>

          <section>
            <h3 className="text-lg font-medium mb-1 text-emerald-500">
              Multiline Input:
            </h3>
            <ul className="list-disc list-inside pl-2 space-y-1">
              <li>Type queries across multiple lines.</li>
              <li>
                Press{" "}
                <code className="bg-secondary px-1 rounded">
                  Enter
                </code>{" "}
                for new line (unless ending with{" "}
                <code className="bg-secondary px-1 rounded">
                  ;
                </code>
                ).
              </li>
              <li>
                <code className="bg-secondary px-1 rounded">
                  Shift + Enter
                </code>{" "}
                - Force new line.
              </li>
              <li>
                End with{" "}
                <code className="bg-secondary px-1 rounded">
                  ;
                </code>{" "}
                then press{" "}
                <code className="bg-secondary px-1 rounded">
                  Enter
                </code>{" "}
                to execute.
              </li>
              <li>
                <code className="bg-secondary px-1 rounded">
                  Tab
                </code>{" "}
                - Indent.
              </li>
              <li>
                <code className="bg-secondary px-1 rounded">
                  Ctrl + C
                </code>{" "}
                - Cancel and clear current input.
              </li>
            </ul>
          </section>

          <section>
            <h3 className="text-lg font-medium mb-1 text-emerald-500">
              AI Query Tips:
            </h3>
            <ul className="list-disc list-inside pl-2 space-y-1">
              <li>Be specific (e.g., &quot;users with names starting with A&quot;).</li>
              <li>AI knows your schema.</li>
              <li>If AI makes a mistake, rephrase your question.</li>
              <li>
                Example:{" "}
                <code className="bg-secondary px-1 rounded">
                  /ai list all tables I can access
                </code>
              </li>
              <li>
                Example:{" "}
                <code className="bg-secondary px-1 rounded">
                  /ai create a table named &apos;products&apos; ...
                </code>
              </li>
            </ul>
          </section>

          <section>
            <h3 className="text-lg font-medium mb-1 text-emerald-500">
              Keyboard Shortcuts:
            </h3>
            <ul className="list-disc list-inside pl-2 space-y-1">
              <li>
                <code className="bg-secondary px-1 rounded">
                  ArrowUp
                </code>{" "}
                /{" "}
                <code className="bg-secondary px-1 rounded">
                  ArrowDown
                </code>{" "}
                - Navigate command history.
              </li>
            </ul>
          </section>
        </div>

        <DialogFooter className="mt-4">
          <DialogClose asChild>
            <button className="px-4 py-2 bg-secondary rounded hover:bg-gray-300 dark:hover:bg-gray-600">
              Close
            </button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
