import 'react';

declare module 'react' {
  interface CSSProperties {
    WebkitTextSecurity?: string;
    // Add any other vendor-specific properties you might need here
  }
}
