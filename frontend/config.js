// Public runtime configuration for RepoHosting frontend.
// The Supabase anon/publishable key is designed to be exposed in client code;
// row-level security + edge functions enforce real authorization.
window.REPOHOSTING_CONFIG = {
  SUPABASE_URL: 'https://acqxqktadzwrngzcyyzo.supabase.co',
  SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjcXhxa3RhZHp3cm5nemN5eXpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4MjAwMzIsImV4cCI6MjA5ODM5NjAzMn0.Veg-Hpbyz1ghPaIQZ4nwaZuAnlvvEWihBy2bnoAxoYU',
  FUNCTIONS_BASE: 'https://acqxqktadzwrngzcyyzo.functions.supabase.co',
};
