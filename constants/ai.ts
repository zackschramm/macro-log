import { supabase } from './supabase';

export async function callAI(messages: { role: string; content: string }[], system?: string, max_tokens = 16000) {
  const { data: { session } } = await supabase.auth.getSession();
  
  const response = await fetch(
    'https://zbcxuffgmjuqarapfdwb.supabase.co/functions/v1/ai-proxy',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpiY3h1ZmZnbWp1cWFyYXBmZHdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjQ4NjIsImV4cCI6MjA4NzQwMDg2Mn0.lUng1tY_aAuee_t8-E5MSUHdm2PF3HzsE41L-kzBmJE',
      },
      body: JSON.stringify({ messages, system, max_tokens }),
    }
  );

  const data = await response.json();
  return data.content?.find((b: any) => b.type === 'text')?.text || '';
}
