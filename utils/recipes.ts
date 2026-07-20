import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../constants/supabase';

export const RECIPES_KEY = 'fuelog_recipes';

export type RecipeIngredient = {
  name: string;
  brand?: string;
  serving_size?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  qty: number;
};

export type Recipe = {
  id: string;
  name: string;
  servings: number;
  ingredients: RecipeIngredient[];
  per_serving_calories: number;
  per_serving_protein: number;
  per_serving_carbs: number;
  per_serving_fat: number;
  photo_uri?: string;
  created_at: string;
};

function rowToRecipe(r: Record<string, unknown>): Recipe {
  return {
    id: String(r.id),
    name: String(r.name),
    servings: Number(r.servings),
    ingredients: Array.isArray(r.ingredients) ? (r.ingredients as RecipeIngredient[]) : [],
    per_serving_calories: Number(r.per_serving_calories),
    per_serving_protein: Number(r.per_serving_protein),
    per_serving_carbs: Number(r.per_serving_carbs),
    per_serving_fat: Number(r.per_serving_fat),
    photo_uri: r.photo_uri ? String(r.photo_uri) : undefined,
    created_at: String(r.created_at),
  };
}

async function getLocal(): Promise<Recipe[]> {
  const raw = await AsyncStorage.getItem(RECIPES_KEY);
  return raw ? (JSON.parse(raw) as Recipe[]) : [];
}

export async function loadRecipes(userId: string): Promise<Recipe[]> {
  try {
    const { data, error } = await supabase
      .from('user_recipes')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (!error && data) {
      const recipes = data.map(r => rowToRecipe(r as Record<string, unknown>));
      await AsyncStorage.setItem(RECIPES_KEY, JSON.stringify(recipes));
      return recipes;
    }
  } catch {}
  return getLocal();
}

export async function saveRecipe(
  userId: string,
  recipe: Omit<Recipe, 'id' | 'created_at'>,
): Promise<Recipe> {
  try {
    const { data, error } = await supabase
      .from('user_recipes')
      .insert({
        user_id: userId,
        name: recipe.name,
        servings: recipe.servings,
        ingredients: recipe.ingredients,
        per_serving_calories: recipe.per_serving_calories,
        per_serving_protein: recipe.per_serving_protein,
        per_serving_carbs: recipe.per_serving_carbs,
        per_serving_fat: recipe.per_serving_fat,
        photo_uri: recipe.photo_uri ?? null,
      })
      .select()
      .single();
    if (!error && data) {
      const saved = rowToRecipe(data as Record<string, unknown>);
      const existing = await getLocal();
      await AsyncStorage.setItem(RECIPES_KEY, JSON.stringify([saved, ...existing]));
      return saved;
    }
  } catch {}
  // AsyncStorage fallback
  const id = `local_${Date.now()}`;
  const saved: Recipe = { ...recipe, id, created_at: new Date().toISOString() };
  const existing = await getLocal();
  await AsyncStorage.setItem(RECIPES_KEY, JSON.stringify([saved, ...existing]));
  return saved;
}

export async function deleteRecipe(userId: string, recipeId: string): Promise<void> {
  if (!recipeId.startsWith('local_')) {
    try {
      await supabase
        .from('user_recipes')
        .delete()
        .eq('id', recipeId)
        .eq('user_id', userId);
    } catch {}
  }
  const existing = await getLocal();
  await AsyncStorage.setItem(
    RECIPES_KEY,
    JSON.stringify(existing.filter(r => r.id !== recipeId)),
  );
}
