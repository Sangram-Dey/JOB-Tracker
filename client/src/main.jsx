import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from './components/ui.jsx';
import { ThemeProvider } from 'next-themes';
import App from './App.jsx';
import './index.css';

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!publishableKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY: copy client/.env.example to client/.env');

// TanStack Query caches server data by key (e.g. ['profile']) and handles loading/error states.
// Every action reports back: failures as an error toast (unless meta.inline: the form shows it next to the field),
// and meta.success ('text' or (data, vars) => 'text') as a success toast.
const mutationCache = new MutationCache({
  onError: (err, _vars, _ctx, m) => !m.meta?.inline && toast(err.issues?.[0]?.message ?? err.message ?? 'Something went wrong. Try again.', 'error'),
  onSuccess: (data, vars, _ctx, m) => {
    const text = typeof m.meta?.success === 'function' ? m.meta.success(data, vars) : m.meta?.success;
    if (text) toast(text, 'success');
  },
});
const queryClient = new QueryClient({ mutationCache, defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* ClerkProvider loads Clerk in the browser and keeps the signed-in session fresh. */}
    <ClerkProvider publishableKey={publishableKey} appearance={{ variables: { colorPrimary: '#0f766e', borderRadius: '0.5rem', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' } }}>
      <QueryClientProvider client={queryClient}>
        {/* Puts class="dark" on <html> when dark mode is on; remembers the choice in localStorage. */}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <App />
        </ThemeProvider>
      </QueryClientProvider>
    </ClerkProvider>
  </StrictMode>,
);
