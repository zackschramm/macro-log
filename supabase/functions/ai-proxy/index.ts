import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function getNutrient(nutrients: any[], ...names: string[]) {
  for (const name of names) {
    const found = nutrients.find((n: any) => n.nutrientName?.toLowerCase().includes(name.toLowerCase()));
    if (found) return Math.round((found.value || 0) * 100) / 100;
  }
  return 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

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
      const n = f.foodNutrients || []
      return {
        name: f.description,
        brand: f.brandOwner || f.brandName || null,
        serving_size: f.servingSize ? `${f.servingSize}${f.servingSizeUnit || 'g'}` : '100g',
        calories: Math.round(getNutrient(n, 'energy', 'calorie')),
        protein: getNutrient(n, 'protein'),
        carbs: getNutrient(n, 'carbohydrate'),
        fat: getNutrient(n, 'total lipid'),
        vitamin_a: getNutrient(n, 'vitamin a'),
        vitamin_c: getNutrient(n, 'vitamin c'),
        vitamin_d: getNutrient(n, 'vitamin d'),
        vitamin_e: getNutrient(n, 'vitamin e'),
        vitamin_k: getNutrient(n, 'vitamin k'),
        vitamin_b1: getNutrient(n, 'thiamin'),
        vitamin_b2: getNutrient(n, 'riboflavin'),
        vitamin_b3: getNutrient(n, 'niacin'),
        vitamin_b5: getNutrient(n, 'pantothenic'),
        vitamin_b6: getNutrient(n, 'vitamin b-6'),
        vitamin_b7: getNutrient(n, 'biotin'),
        vitamin_b9: getNutrient(n, 'folate', 'folic'),
        vitamin_b12: getNutrient(n, 'vitamin b-12'),
        calcium: getNutrient(n, 'calcium'),
        iron: getNutrient(n, 'iron'),
        magnesium: getNutrient(n, 'magnesium'),
        phosphorus: getNutrient(n, 'phosphorus'),
        potassium: getNutrient(n, 'potassium'),
        sodium: getNutrient(n, 'sodium'),
        zinc: getNutrient(n, 'zinc'),
        copper: getNutrient(n, 'copper'),
        manganese: getNutrient(n, 'manganese'),
        selenium: getNutrient(n, 'selenium'),
        chromium: getNutrient(n, 'chromium'),
        iodine: getNutrient(n, 'iodine'),
        omega3: getNutrient(n, 'omega-3', 'epa', 'dha'),
      }
    })
    return new Response(JSON.stringify({ foods }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // AI proxy
  try {
    const { messages, system, max_tokens } = await req.json()
    const body = JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: max_tokens || 1000,
        system,
        messages,
      });
    console.log('Sending to Anthropic:', body.substring(0, 500));
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') || '',
        'anthropic-version': '2023-06-01',
      },
      body,
    })
    const data = await response.json()
    console.log('Anthropic response:', JSON.stringify(data).substring(0, 500));
    if (data.type === 'error') {
      return new Response(JSON.stringify({ error: data.error?.message || 'Anthropic error' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
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
