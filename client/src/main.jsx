import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import App from './App.jsx';
import './index.css';

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!publishableKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY: copy client/.env.example to client/.env');

// TanStack Query caches server data by key (e.g. ['profile']) and handles loading/error states.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* ClerkProvider loads Clerk in the browser and keeps the signed-in session fresh. */}
    <ClerkProvider publishableKey={publishableKey}>
      <QueryClientProvider client={queryClient}>
        {/* Puts class="dark" on <html> when dark mode is on; remembers the choice in localStorage. */}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <App />
        </ThemeProvider>
      </QueryClientProvider>
    </ClerkProvider>
  </StrictMode>,
);
