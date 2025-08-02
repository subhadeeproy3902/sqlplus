'use client'

import { Loader as LucideLoader } from 'lucide-react'

interface LoaderProps {
  message?: string
}

export default function Loader({ message = "Loading..." }: LoaderProps) {
  return (
    <div className="flex items-center space-x-2 text-blue-400 dark:text-blue-300">
      <LucideLoader className="w-5 h-5 animate-spin" />
      <span className="text-sm">{message}</span>
    </div>
  )
}
