import { sb, fetchAll } from './supabase.js';

export const state = {
  user: null,               // auth user
  profile: null,            // row from profiles
  foodTypes: [],
  restaurants: [],          // rows from restaurants_with_stats
  byId: new Map(),
  myVotes: new Map(),       // restaurant_id -> 1 | -1
  following: new Set(),     // user ids I follow
  followedUpvoted: new Set(), // restaurant ids thumbs-upped by people I follow
};

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
export const emit = () => listeners.forEach((fn) => fn());

export function resetState() {
  Object.assign(state, {
    user: null, profile: null, foodTypes: [], restaurants: [], byId: new Map(),
    myVotes: new Map(), following: new Set(), followedUpvoted: new Set(),
  });
  emit();
}

export async function loadAll() {
  await Promise.all([loadFoodTypes(), loadRestaurants(), loadMyVotes(), loadFollowing()]);
  emit();
}

export async function loadFoodTypes() {
  const { data, error } = await sb.from('food_types').select('*').order('sort_order').order('name');
  if (error) throw error;
  state.foodTypes = data;
}

export async function loadRestaurants() {
  state.restaurants = await fetchAll(() => sb.from('restaurants_with_stats').select('*').order('id'));
  state.byId = new Map(state.restaurants.map((r) => [r.id, r]));
}

async function loadMyVotes() {
  const rows = await fetchAll(() =>
    sb.from('votes').select('restaurant_id, value').eq('user_id', state.user.id).order('restaurant_id'));
  state.myVotes = new Map(rows.map((v) => [v.restaurant_id, v.value]));
}

export async function loadFollowing() {
  const rows = await fetchAll(() =>
    sb.from('follows').select('followee_id').eq('follower_id', state.user.id).order('followee_id'));
  state.following = new Set(rows.map((f) => f.followee_id));

  state.followedUpvoted = new Set();
  const ids = [...state.following];
  // Chunk the id list to keep request URLs short.
  for (let i = 0; i < ids.length; i += 100) {
    const votes = await fetchAll(() =>
      sb.from('votes').select('restaurant_id, user_id').eq('value', 1)
        .in('user_id', ids.slice(i, i + 100)).order('restaurant_id').order('user_id'));
    votes.forEach((v) => state.followedUpvoted.add(v.restaurant_id));
  }
}

// Re-read one restaurant (after a vote, comment or edit) without reloading everything.
export async function refreshRestaurant(id) {
  const { data, error } = await sb.from('restaurants_with_stats').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  const idx = state.restaurants.findIndex((r) => r.id === id);
  if (!data) {
    if (idx >= 0) state.restaurants.splice(idx, 1);
    state.byId.delete(id);
  } else {
    if (idx >= 0) state.restaurants[idx] = data;
    else state.restaurants.push(data);
    state.byId.set(id, data);
  }
  emit();
  return data;
}

export function removeRestaurant(id) {
  state.restaurants = state.restaurants.filter((r) => r.id !== id);
  state.byId.delete(id);
  state.myVotes.delete(id);
  emit();
}
