import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)

  // USDA food search
  if (url.pathname.endsWith('/food-search')) {
    const { query } = await req.json()
    const apiKey = Deno.env.get('USDA_API_KEY') || ''
    const res = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&pageSize=10&api_key=${apiKey}`
    )
    const data = await res.json()
    const foods = (data.foods || []).map((f: any) => {
      const nutrients = f.foodNutrients || []
      const get = (name: string) => nutrients.find((n: any) => n.nutrientName?.toLowerCase().includes(name))?.value || 0
      return {
        name: f.description,
        brand: f.brandOwner || f.brandName || null,
        serving_size: f.servingSize ? `${f.servingSize}${f.servingSizeUnit || 'g'}` : '100g',
        calories: Math.round(get('energy') || get('calorie')),
        protein: Math.round(get('protein') * 10) / 10,
        carbs: Math.round(get('carbohydrate') * 10) / 10,
        fat: Math.round(get('total lipid') * 10) / 10,
      }
    })
    return new Response(JSON.stringify({ foods }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // AI proxy
  try {
    const { messages, system, max_tokens } = await req.json()
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: max_tokens || 8192,
        system,
        messages,
      }),
    })
    const data = await response.json()
    const text = data.content?.find((b: any) => b.type === 'text')?.text || ''
    return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
