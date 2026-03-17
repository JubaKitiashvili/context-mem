#!/usr/bin/env node
'use strict';

/**
 * context-mem demo data generator
 *
 * Generates realistic observations for dashboard demos and screenshots.
 * All data is fictional — no real project data is used.
 *
 * Usage:
 *   node scripts/demo-data.js [--db path/to/store.db] [--clean]
 *   context-mem demo
 */

const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const clean = args.includes('--clean');
const dbArg = args.indexOf('--db');
const dbPath = dbArg !== -1 && args[dbArg + 1]
  ? args[dbArg + 1]
  : path.join(process.cwd(), '.context-mem', 'store.db');

if (!fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  const cmPath = path.join(__dirname, '..', 'node_modules', 'better-sqlite3');
  Database = require(cmPath);
}

// Run migrations if needed
const { migrations } = require('../dist/plugins/storage/migrations.js');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Ensure all migrations are applied
for (const m of migrations) {
  try { db.exec(m.up); } catch {}
}
console.log('Schema ensured (v' + migrations.length + ')');

if (clean) {
  db.exec('DELETE FROM observations');
  db.exec('DELETE FROM token_stats');
  try { db.exec('DELETE FROM knowledge'); } catch {}
  try { db.exec('DELETE FROM events'); } catch {}
  try { db.exec('DELETE FROM snapshots'); } catch {}
  try { db.exec('DELETE FROM content_sources'); db.exec('DELETE FROM content_chunks'); } catch {}
  console.log('Cleaned existing data');
}

// --- Demo data ---
const now = Date.now();
const HOUR = 3600000;
const DAY = 86400000;

function ulid() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return (ts + rand).toUpperCase();
}

const sessions = [
  { id: 'SESSION_' + ulid(), offset: 0, label: 'Current session' },
  { id: 'SESSION_' + ulid(), offset: -2 * HOUR, label: '2 hours ago' },
  { id: 'SESSION_' + ulid(), offset: -8 * HOUR, label: '8 hours ago' },
  { id: 'SESSION_' + ulid(), offset: -1 * DAY, label: 'Yesterday' },
  { id: 'SESSION_' + ulid(), offset: -2 * DAY, label: '2 days ago' },
  { id: 'SESSION_' + ulid(), offset: -3 * DAY, label: '3 days ago' },
  { id: 'SESSION_' + ulid(), offset: -5 * DAY, label: '5 days ago' },
];

const observations = [
  // --- Session 0: Current work (auth feature) ---
  {
    session: 0, type: 'code', source: 'Read', file: 'src/hooks/useAuth.ts',
    content: `import { useState, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import { api } from '../services/api';

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
}

export const useAuth = () => {
  const [state, setState] = useState<AuthState>({
    user: null, token: null, loading: false
  });

  const login = useCallback(async (email: string, password: string) => {
    setState(prev => ({ ...prev, loading: true }));
    try {
      const { data } = await api.post('/auth/login', { email, password });
      await SecureStore.setItemAsync('auth_token', data.token);
      setState({ user: data.user, token: data.token, loading: false });
    } catch (err) {
      setState(prev => ({ ...prev, loading: false }));
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    await SecureStore.deleteItemAsync('auth_token');
    setState({ user: null, token: null, loading: false });
  }, []);

  return { ...state, login, logout };
};`,
    summary: 'useAuth hook — SecureStore token persistence, login/logout with loading state',
    offsetMin: 0,
  },
  {
    session: 0, type: 'test', source: 'Bash',
    content: `PASS src/hooks/__tests__/useAuth.test.ts
  useAuth hook
    ✓ returns null user initially (3ms)
    ✓ login stores token in SecureStore (15ms)
    ✓ login sets user and token state (8ms)
    ✓ logout clears stored token (5ms)
    ✓ logout resets state (3ms)
    ✓ handles login failure gracefully (12ms)
    ✓ sets loading during login (7ms)

Test Suites: 1 passed, 1 total
Tests:       7 passed, 7 total
Snapshots:   0 total
Time:        1.892s`,
    summary: '7/7 tests pass — useAuth hook: login, logout, loading, error handling',
    offsetMin: 2,
  },
  {
    session: 0, type: 'error', source: 'Bash',
    content: `TypeError: Cannot read properties of undefined (reading 'navigate')
    at ProfileScreen (src/screens/ProfileScreen.tsx:42:18)
    at renderWithHooks (node_modules/react-dom/cjs/react-dom.development.js:14985:18)
    at mountIndeterminateComponent (node_modules/react-dom/cjs/react-dom.development.js:17811:13)
    at beginWork (node_modules/react-dom/cjs/react-dom.development.js:19049:16)

The above error occurred in the <ProfileScreen> component:
    at ProfileScreen (src/screens/ProfileScreen.tsx:24:5)
    at Route (node_modules/@react-navigation/core/src/Route.tsx:12:14)`,
    summary: 'TypeError: navigation undefined in ProfileScreen — missing useNavigation hook',
    offsetMin: 5,
  },
  {
    session: 0, type: 'decision', source: 'Edit',
    content: 'Decision: Use React Query for server state management + Zustand only for client UI state (cart, preferences, theme). Rationale: React Query handles caching, background refetch, and optimistic updates out of the box. Zustand remains lightweight for synchronous client state.',
    summary: 'Architecture: React Query for server state, Zustand for client-only state',
    offsetMin: 8,
  },
  {
    session: 0, type: 'code', source: 'Read', file: 'src/components/ProductCard.tsx',
    content: `import { memo } from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { formatCurrency } from '../utils/format';

interface ProductCardProps {
  product: Product;
  onPress: (id: string) => void;
}

export const ProductCard = memo(({ product, onPress }: ProductCardProps) => (
  <Pressable style={styles.card} onPress={() => onPress(product.id)}>
    <Image source={{ uri: product.imageUrl }} style={styles.image} />
    <View style={styles.info}>
      <Text style={styles.name} numberOfLines={2}>{product.name}</Text>
      <Text style={styles.price}>{formatCurrency(product.price)}</Text>
      {product.discount > 0 && (
        <Text style={styles.discount}>-{product.discount}%</Text>
      )}
    </View>
  </Pressable>
));`,
    summary: 'ProductCard — memoized component with image, price, discount badge',
    offsetMin: 12,
  },
  {
    session: 0, type: 'commit', source: 'Bash',
    content: `feat(auth): implement secure token-based authentication

- Add useAuth hook with SecureStore persistence
- Implement login/logout with loading states
- Add error handling for failed auth attempts
- Tests: 7/7 passing
- Migrate from AsyncStorage to expo-secure-store`,
    summary: 'feat(auth): SecureStore-based auth with 7/7 tests passing',
    offsetMin: 15,
  },

  // --- Session 1: Performance optimization ---
  {
    session: 1, type: 'code', source: 'Read', file: 'src/components/ProductList.tsx',
    content: `import { FlashList } from '@shopify/flash-list';
import { ProductCard } from './ProductCard';
import { useProducts } from '../hooks/useProducts';
import { ListEmptyState } from './ListEmptyState';
import { ListSkeleton } from './ListSkeleton';

export const ProductList = () => {
  const { data, isLoading, fetchNextPage, hasNextPage } = useProducts();

  if (isLoading) return <ListSkeleton count={6} />;

  const products = data?.pages.flatMap(p => p.items) ?? [];

  return (
    <FlashList
      data={products}
      renderItem={({ item }) => <ProductCard product={item} onPress={handlePress} />}
      estimatedItemSize={180}
      numColumns={2}
      onEndReached={() => hasNextPage && fetchNextPage()}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={ListEmptyState}
    />
  );
};`,
    summary: 'ProductList — FlashList with pagination, skeleton loading, 2-column grid',
    offsetMin: 0,
  },
  {
    session: 1, type: 'log', source: 'Bash',
    content: `Performance Test Results:
┌─────────────────────┬───────────┬───────────┐
│ Metric              │ FlatList  │ FlashList │
├─────────────────────┼───────────┼───────────┤
│ Initial render      │ 234ms     │ 89ms      │
│ Scroll FPS (avg)    │ 42fps     │ 58fps     │
│ Memory peak         │ 187MB     │ 124MB     │
│ Items rendered      │ 500       │ 500       │
│ JS thread (avg)     │ 12.3ms    │ 4.1ms     │
│ UI thread (avg)     │ 8.7ms     │ 3.2ms     │
└─────────────────────┴───────────┴───────────┘

Recommendation: Migrate to FlashList for 38% FPS improvement`,
    summary: 'FlashList vs FlatList benchmark — 38% FPS improvement, 34% less memory',
    offsetMin: 3,
  },
  {
    session: 1, type: 'decision', source: 'Edit',
    content: 'Decision: Migrate all list components from FlatList to FlashList. Priority order: ProductList (500+ items), OrderHistory (100+ items), SearchResults (variable). Keep FlatList only for short static lists (<20 items) where FlashList overhead is unnecessary.',
    summary: 'Migrate FlatList → FlashList for all lists with 20+ items',
    offsetMin: 5,
  },

  // --- Session 2: API integration ---
  {
    session: 2, type: 'code', source: 'Read', file: 'src/services/api.ts',
    content: `import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '../config';

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('auth_token');
  if (token) config.headers.Authorization = \`Bearer \${token}\`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      await SecureStore.deleteItemAsync('auth_token');
      // Navigate to login
    }
    return Promise.reject(error);
  }
);`,
    summary: 'API client — axios with SecureStore token injection and 401 auto-logout',
    offsetMin: 0,
  },
  {
    session: 2, type: 'error', source: 'Bash',
    content: `AxiosError: Network Error
    at XMLHttpRequest.handleError (node_modules/axios/lib/adapters/xhr.js:175:14)
    at XMLHttpRequest.dispatchEvent (node_modules/event-target-shim/dist/event-target-shim.js:818:39)

Cause: CORS policy blocked request to https://api.example.com/v1/products
Origin http://localhost:8081 is not allowed by Access-Control-Allow-Origin

Config: { method: 'GET', url: '/products', timeout: 10000 }`,
    summary: 'CORS error on /products — origin localhost:8081 blocked by API',
    offsetMin: 2,
  },
  {
    session: 2, type: 'log', source: 'Bash',
    content: `BUILD SUCCESSFUL in 34s
247 actionable tasks: 18 executed, 229 up-to-date
info Writing bundle output to: dist/main.jsbundle
info Writing sourcemap output to: dist/main.jsbundle.map
info Done writing bundle output (1.34 MB)
info Done writing sourcemap output (4.21 MB)
info Copying 142 asset files

Bundle analysis:
  Total size: 1.34 MB (gzipped: 412 KB)
  node_modules: 892 KB (67%)
  src: 448 KB (33%)
  Largest modules:
    react-native: 234 KB
    @shopify/flash-list: 45 KB
    axios: 38 KB
    zustand: 12 KB`,
    summary: 'Build OK — 1.34MB bundle (412KB gzip), 34s, 247 tasks',
    offsetMin: 5,
  },

  // --- Session 3: Testing ---
  {
    session: 3, type: 'test', source: 'Bash',
    content: `Test Suites: 23 passed, 23 total
Tests:       147 passed, 147 total
Snapshots:   12 passed, 12 total
Time:        8.234s, estimated 9s

Coverage summary:
  Statements   : 78.4% ( 892/1138 )
  Branches     : 71.2% ( 234/329 )
  Functions    : 82.1% ( 187/228 )
  Lines        : 79.8% ( 876/1098 )

Uncovered files:
  src/services/analytics.ts  (12%)
  src/utils/deepLink.ts      (34%)
  src/screens/Settings.tsx    (45%)`,
    summary: '147/147 tests pass — 78.4% statement coverage, 3 files need attention',
    offsetMin: 0,
  },
  {
    session: 3, type: 'error', source: 'Bash',
    content: `FAIL src/screens/__tests__/Checkout.test.tsx
  ● CheckoutScreen › should calculate total with discount

    expect(received).toBe(expected)

    Expected: 42.50
    Received: 42.49999999999999

      34 |   const total = calculateTotal(items, discount);
      35 |   expect(total).toBe(42.50);
         |                 ^
      36 | });

    at Object.<anonymous> (src/screens/__tests__/Checkout.test.tsx:35:17)`,
    summary: 'Checkout test fail — floating point precision: expected 42.50, got 42.499...',
    offsetMin: 1,
  },
  {
    session: 3, type: 'code', source: 'Edit', file: 'src/utils/currency.ts',
    content: `/**
 * Safe currency calculation avoiding floating point errors.
 * Works in cents (integers) and converts back to dollars.
 */
export const calculateTotal = (
  items: CartItem[],
  discountPct: number = 0
): number => {
  const subtotalCents = items.reduce(
    (sum, item) => sum + Math.round(item.price * 100) * item.quantity,
    0
  );
  const discountCents = Math.round(subtotalCents * (discountPct / 100));
  return (subtotalCents - discountCents) / 100;
};`,
    summary: 'calculateTotal — integer cents arithmetic to avoid floating point errors',
    offsetMin: 3,
  },

  // --- Session 4: Navigation ---
  {
    session: 4, type: 'code', source: 'Read', file: 'src/navigation/AppNavigator.tsx',
    content: `import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../hooks/useAuth';

const Stack = createNativeStackNavigator<RootStackParams>();
const Tab = createBottomTabNavigator<TabParams>();

const MainTabs = () => (
  <Tab.Navigator screenOptions={{ headerShown: false }}>
    <Tab.Screen name="Home" component={HomeScreen} />
    <Tab.Screen name="Search" component={SearchScreen} />
    <Tab.Screen name="Cart" component={CartScreen} />
    <Tab.Screen name="Profile" component={ProfileScreen} />
  </Tab.Navigator>
);

export const AppNavigator = () => {
  const { user } = useAuth();
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          <Stack.Screen name="Main" component={MainTabs} />
        ) : (
          <Stack.Screen name="Auth" component={AuthStack} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};`,
    summary: 'AppNavigator — conditional auth flow with bottom tabs (Home, Search, Cart, Profile)',
    offsetMin: 0,
  },

  // --- Session 5: Styling ---
  {
    session: 5, type: 'code', source: 'Read', file: 'src/theme/tokens.ts',
    content: `export const colors = {
  primary: '#6366f1',
  primaryDark: '#4f46e5',
  secondary: '#06b6d4',
  background: '#0f0f14',
  surface: '#1a1a24',
  surfaceHover: '#22222e',
  text: '#e2e2e8',
  textDim: '#6b6b80',
  success: '#22c55e',
  error: '#ef4444',
  warning: '#f59e0b',
  border: '#2a2a3a',
} as const;

export const spacing = {
  xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48,
} as const;

export const radius = {
  sm: 6, md: 10, lg: 16, full: 9999,
} as const;`,
    summary: 'Design tokens — colors, spacing, radius constants for consistent theming',
    offsetMin: 0,
  },
  {
    session: 5, type: 'context', source: 'Grep',
    content: `Found 23 files matching "StyleSheet.create"
src/components/ProductCard.tsx:45
src/components/Button.tsx:67
src/components/Header.tsx:34
src/components/ListSkeleton.tsx:28
src/components/Badge.tsx:19
src/screens/HomeScreen.tsx:89
src/screens/ProfileScreen.tsx:56
src/screens/CartScreen.tsx:72
src/screens/SearchScreen.tsx:61
src/screens/CheckoutScreen.tsx:94
...13 more files`,
    summary: '23 files use StyleSheet.create — candidates for design token migration',
    offsetMin: 2,
  },

  // --- Session 5 continued: More styling work ---
  {
    session: 5, type: 'commit', source: 'Bash',
    content: `refactor(theme): migrate to design token system

- Extract colors, spacing, radius to src/theme/tokens.ts
- Replace 23 hardcoded color values across 12 components
- Add dark mode support via theme context
- Typography scale: 12/14/16/20/24/32px`,
    summary: 'refactor(theme): design tokens replacing 23 hardcoded colors in 12 components',
    offsetMin: 5,
  },

  // --- Session 6: Deployment & config ---
  {
    session: 6, type: 'log', source: 'Bash',
    content: `Deployment Summary:
  Platform: iOS + Android
  Version: 1.2.0 (build 45)
  Environment: staging
  EAS Build ID: abc123def456
  iOS: Uploaded to TestFlight
  Android: Uploaded to Play Console (internal track)
  Bundle: 1.34 MB (within 1.5 MB limit)
  Assets: 142 files copied
  Duration: 4m 23s`,
    summary: 'v1.2.0 deployed to staging — iOS TestFlight + Android internal, 4m23s',
    offsetMin: 0,
  },
  {
    session: 6, type: 'code', source: 'Read', file: 'src/config/index.ts',
    content: `// Environment configuration
export const config = {
  API_BASE_URL: process.env.EXPO_PUBLIC_API_URL || 'https://api.example.com/v1',
  SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN || '',
  ANALYTICS_KEY: '[REDACTED]',
  FEATURE_FLAGS: {
    newCheckout: true,
    darkMode: true,
    biometricAuth: false,
  },
};`,
    summary: 'App config — API URL, feature flags (newCheckout, darkMode on; biometric off)',
    offsetMin: 3,
    privacy: 'redacted',
  },
  {
    session: 6, type: 'decision', source: 'Edit',
    content: 'Decision: Enable EAS Update for OTA patches. Critical bug fixes can be pushed within minutes instead of waiting for store review. Set update policy: mandatory for security fixes, optional for UI tweaks. Rollback via embedded fallback.',
    summary: 'Enable EAS Update — OTA patches for critical fixes, mandatory for security',
    offsetMin: 5,
  },
  {
    session: 6, type: 'test', source: 'Bash',
    content: `E2E Test Results (Detox):
  ✓ Login flow — email + password (4.2s)
  ✓ Login flow — biometric fallback (2.8s)
  ✓ Product browse — scroll + filter (3.1s)
  ✓ Add to cart — quantity update (2.4s)
  ✓ Checkout — complete purchase (6.7s)
  ✓ Profile — edit + save (3.5s)
  ✓ Deep link — product/:id (1.9s)
  ✓ Push notification — tap opens correct screen (2.1s)

  8 passing (26.7s)
  0 failing`,
    summary: 'E2E: 8/8 Detox tests pass — login, browse, cart, checkout, deep links, push',
    offsetMin: 8,
  },

  // --- Extra observations for rich dashboard ---
  {
    session: 0, type: 'context', source: 'Grep',
    content: `Found 8 files matching "useCallback"
src/hooks/useAuth.ts:17
src/hooks/useCart.ts:23
src/hooks/useProducts.ts:31
src/hooks/useSearch.ts:12
src/components/ProductCard.tsx:15
src/components/SearchBar.tsx:22
src/screens/CartScreen.tsx:34
src/screens/CheckoutScreen.tsx:45`,
    summary: '8 files use useCallback — review for unnecessary memoization',
    offsetMin: 18,
  },
  {
    session: 1, type: 'commit', source: 'Bash',
    content: `perf: migrate ProductList to FlashList

- Replace FlatList with FlashList (estimatedItemSize=180)
- 38% FPS improvement (42 → 58fps)
- 34% memory reduction (187MB → 124MB peak)
- Add ListSkeleton loading state
- Pagination with onEndReached`,
    summary: 'perf: FlashList migration — 38% FPS gain, 34% less memory',
    offsetMin: 8,
  },
  {
    session: 2, type: 'code', source: 'Read', file: 'src/hooks/useProducts.ts',
    content: `import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../services/api';

interface ProductsResponse {
  items: Product[];
  nextCursor: string | null;
  total: number;
}

export const useProducts = (category?: string) => {
  return useInfiniteQuery({
    queryKey: ['products', category],
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get<ProductsResponse>('/products', {
        params: { cursor: pageParam, limit: 20, category },
      });
      return data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 5 * 60 * 1000, // 5 min
  });
};`,
    summary: 'useProducts — React Query infinite scroll with 5min stale time, cursor pagination',
    offsetMin: 8,
  },
  {
    session: 3, type: 'commit', source: 'Bash',
    content: `fix(checkout): resolve floating point precision in total calculation

- Switch to integer cents arithmetic (avoid IEEE 754 errors)
- calculateTotal now works in cents and converts back
- Fix: 42.49999999999999 → 42.50
- Added 5 edge case tests for rounding`,
    summary: 'fix(checkout): cents-based arithmetic fixes floating point total calculation',
    offsetMin: 5,
  },
  {
    session: 4, type: 'error', source: 'Bash',
    content: `Warning: Each child in a list should have a unique "key" prop.
    at TabNavigator (src/navigation/AppNavigator.tsx:23:5)

Check the render method of \`AppNavigator\`. See https://reactjs.org/link/warning-keys for more information.

Warning: Cannot update a component (\`AppNavigator\`) while rendering a different component (\`AuthScreen\`). To locate the bad setState() call inside \`AuthScreen\`, follow the stack trace.`,
    summary: 'React key warning in TabNavigator + setState during render in AuthScreen',
    offsetMin: 3,
  },
  {
    session: 4, type: 'code', source: 'Read', file: 'src/screens/HomeScreen.tsx',
    content: `import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ProductGrid } from '../components/ProductGrid';
import { CategoryTabs } from '../components/CategoryTabs';
import { PromoBanner } from '../components/PromoBanner';
import { useAuth } from '../hooks/useAuth';

export const HomeScreen = () => {
  const { user } = useAuth();
  const { data: featured, refetch, isRefetching } = useQuery({
    queryKey: ['featured'],
    queryFn: () => api.get('/products/featured').then(r => r.data),
  });

  return (
    <ScrollView
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
    >
      <PromoBanner />
      <Text style={styles.greeting}>Welcome, {user?.name ?? 'Guest'}</Text>
      <CategoryTabs />
      <ProductGrid products={featured?.items ?? []} />
    </ScrollView>
  );
};`,
    summary: 'HomeScreen — pull-to-refresh, promo banner, categories, featured products grid',
    offsetMin: 6,
  },
];

// --- Insert data ---
const insertObs = db.prepare(`
  INSERT OR IGNORE INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level, session_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertStats = db.prepare(`
  INSERT INTO token_stats (session_id, event_type, tokens_in, tokens_out, timestamp)
  VALUES (?, ?, ?, ?, ?)
`);

let totalInserted = 0;

const insertAll = db.transaction(() => {
  for (const obs of observations) {
    const session = sessions[obs.session];
    const ts = now + session.offset + (obs.offsetMin * 60000);
    const id = 'DEMO_' + ulid();
    const tokensOrig = Math.ceil(obs.content.length / 4);
    const tokensSumm = obs.summary ? Math.ceil(obs.summary.length / 4) : tokensOrig;
    const privacy = obs.privacy || 'public';

    const metadata = JSON.stringify({
      source: obs.source,
      file_path: obs.file || undefined,
      tokens_original: tokensOrig,
      tokens_summarized: tokensSumm,
      privacy_level: privacy,
      session_id: session.id,
    });

    insertObs.run(id, obs.type, obs.content, obs.summary, metadata, ts, privacy, session.id);
    insertStats.run(session.id, 'store', tokensOrig, tokensSumm, ts);
    totalInserted++;
  }

  // Add search events (active usage)
  for (let i = 0; i < 35; i++) {
    const s = sessions[Math.floor(Math.random() * sessions.length)];
    const ts = now + s.offset + Math.random() * HOUR;
    insertStats.run(s.id, 'discovery', 0, Math.floor(Math.random() * 20) + 8, ts);
  }

  // Add read events (context reuse)
  for (let i = 0; i < 25; i++) {
    const s = sessions[Math.floor(Math.random() * 5)];
    const ts = now + s.offset + Math.random() * HOUR;
    insertStats.run(s.id, 'read', 0, Math.floor(Math.random() * 40) + 15, ts);
  }

  // Add extra store events with strong compression (~96% target, matching real usage)
  for (let i = 0; i < 35; i++) {
    const s = sessions[Math.floor(Math.random() * sessions.length)];
    const ts = now + s.offset + Math.random() * HOUR;
    const tokIn = Math.floor(Math.random() * 1200) + 300;
    const tokOut = Math.floor(tokIn * (0.03 + Math.random() * 0.06)); // 91-97% compression
    insertStats.run(s.id, 'store', tokIn, tokOut, ts);
  }
});

insertAll();

// --- New features demo data ---

// Knowledge Base entries
const knowledgeEntries = [
  { category: 'pattern', title: 'FlashList for large lists', content: 'Use @shopify/flash-list instead of FlatList for lists with 20+ items. Provides 38% FPS improvement and 34% memory reduction. Set estimatedItemSize for optimal recycling.', tags: 'performance,lists,flashlist', score: 0.92 },
  { category: 'decision', title: 'React Query for server state', content: 'Architecture decision: Use React Query (@tanstack/react-query) for all server state. Zustand only for client-only state (cart, theme, preferences). React Query handles caching, background refetch, optimistic updates.', tags: 'architecture,state,react-query', score: 0.88 },
  { category: 'error', title: 'Floating point in currency', content: 'IEEE 754 floating point causes precision errors in currency calculations. Always work in integer cents and convert back. Example: 42.50 becomes 4250 cents internally.', tags: 'currency,math,bugs', score: 0.85 },
  { category: 'api', title: 'Auth token flow', content: 'Authentication uses expo-secure-store for token persistence. Axios interceptor injects Bearer token on every request. 401 responses trigger automatic logout and token cleanup.', tags: 'auth,security,tokens', score: 0.90 },
  { category: 'component', title: 'ProductCard memoization', content: 'ProductCard uses React.memo to prevent unnecessary re-renders in FlashList. Only re-renders when product data changes. Do not pass inline arrow functions as props.', tags: 'react,memo,performance', score: 0.78 },
  { category: 'pattern', title: 'Cursor-based pagination', content: 'All paginated API endpoints use cursor-based pagination (not offset). useInfiniteQuery from React Query handles page tracking. getNextPageParam extracts cursor from response.', tags: 'pagination,api,react-query', score: 0.82 },
  { category: 'decision', title: 'EAS Update for OTA', content: 'Enabled EAS Update for over-the-air patches. Mandatory updates for security fixes. Optional updates for UI tweaks. Rollback via embedded fallback bundle.', tags: 'deployment,eas,ota', score: 0.75 },
  { category: 'error', title: 'CORS on localhost', content: 'API requests from localhost:8081 blocked by CORS policy. Solution: Configure API server to allow localhost origins in development, or use Expo proxy.', tags: 'cors,networking,debug', score: 0.70 },
  { category: 'api', title: 'Products endpoint', content: 'GET /products — supports cursor pagination (limit, cursor params), category filter. Returns { items, nextCursor, total }. Stale time: 5 minutes.', tags: 'products,endpoints,rest', score: 0.80 },
  { category: 'component', title: 'HomeScreen structure', content: 'HomeScreen uses ScrollView with RefreshControl for pull-to-refresh. Sections: PromoBanner, CategoryTabs, ProductGrid (featured items). Greeting shows user name.', tags: 'home,screen,layout', score: 0.72 },
];

const insertKnowledge = db.prepare(`
  INSERT OR IGNORE INTO knowledge (id, category, title, content, tags, shareable, relevance_score, access_count, created_at, archived)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
`);

const insertKnowledgeAll = db.transaction(() => {
  for (let i = 0; i < knowledgeEntries.length; i++) {
    const k = knowledgeEntries[i];
    const id = 'K_' + ulid();
    const accessCount = Math.floor(Math.random() * 15) + 1;
    insertKnowledge.run(id, k.category, k.title, k.content, k.tags, 1, k.score, accessCount, now - (i * HOUR));
  }
});
try { insertKnowledgeAll(); } catch {}

// Events
const eventTypes = [
  { type: 'task_start', priority: 1, data: { task: 'Implement auth flow', agent: 'main' } },
  { type: 'file_read', priority: 4, data: { file: 'src/hooks/useAuth.ts', observation_id: 'DEMO_1' } },
  { type: 'file_modify', priority: 2, data: { file: 'src/hooks/useAuth.ts', lines_changed: 45 } },
  { type: 'error', priority: 1, data: { type: 'TypeError', file: 'src/screens/ProfileScreen.tsx', message: 'navigation undefined' } },
  { type: 'file_modify', priority: 2, data: { file: 'src/screens/ProfileScreen.tsx', lines_changed: 3 } },
  { type: 'decision', priority: 2, data: { summary: 'React Query for server state' } },
  { type: 'file_read', priority: 4, data: { file: 'src/components/ProductCard.tsx' } },
  { type: 'search', priority: 4, data: { query: 'useCallback optimization', results_count: 8 } },
  { type: 'dependency_change', priority: 3, data: { package: '@shopify/flash-list', version: '1.7.1', action: 'add' } },
  { type: 'knowledge_save', priority: 3, data: { category: 'pattern', title: 'FlashList for large lists' } },
  { type: 'task_complete', priority: 1, data: { task: 'Implement auth flow', duration_ms: 3600000 } },
  { type: 'error', priority: 1, data: { type: 'CORS', file: 'src/services/api.ts', message: 'Origin blocked' } },
  { type: 'file_modify', priority: 2, data: { file: 'src/services/api.ts', lines_changed: 8 } },
  { type: 'task_start', priority: 1, data: { task: 'Performance optimization', agent: 'main' } },
  { type: 'file_read', priority: 4, data: { file: 'src/components/ProductList.tsx' } },
  { type: 'search', priority: 4, data: { query: 'FlashList migration guide', results_count: 3 } },
  { type: 'file_modify', priority: 2, data: { file: 'src/components/ProductList.tsx', lines_changed: 22 } },
  { type: 'task_complete', priority: 1, data: { task: 'Performance optimization', duration_ms: 1800000 } },
];

const insertEvent = db.prepare(`
  INSERT INTO events (id, session_id, event_type, priority, agent, data, context_bytes, timestamp)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertEventsAll = db.transaction(() => {
  for (let i = 0; i < eventTypes.length; i++) {
    const ev = eventTypes[i];
    const session = sessions[Math.min(i % 3, sessions.length - 1)];
    const dataStr = JSON.stringify(ev.data);
    insertEvent.run(
      'EVT_' + ulid(),
      session.id,
      ev.type,
      ev.priority,
      ev.data.agent || null,
      dataStr,
      Buffer.byteLength(dataStr, 'utf8'),
      now - ((eventTypes.length - i) * 300000) // 5 min intervals
    );
  }
});
try { insertEventsAll(); } catch {}

// Session Snapshots
const insertSnapshot = db.prepare(`
  INSERT OR REPLACE INTO snapshots (session_id, snapshot, created_at) VALUES (?, ?, ?)
`);

const insertSnapshotsAll = db.transaction(() => {
  for (let i = 0; i < Math.min(4, sessions.length); i++) {
    const s = sessions[i];
    const snapshot = {
      session_id: s.id,
      stats: {
        observations: Math.floor(Math.random() * 20) + 5,
        tokens_saved: Math.floor(Math.random() * 50000) + 10000,
        savings_pct: Math.floor(Math.random() * 20) + 80,
      },
      decisions: [
        'Use React Query for server state',
        'Migrate to FlashList for lists > 20 items',
        'Enable EAS Update for OTA patches',
      ].slice(0, Math.floor(Math.random() * 3) + 1),
      errors: ['TypeError: navigation undefined', 'CORS policy blocked'].slice(0, Math.floor(Math.random() * 2)),
      snapshot_at: now + s.offset,
    };
    insertSnapshot.run(s.id, JSON.stringify(snapshot), now + s.offset);
  }
});
try { insertSnapshotsAll(); } catch {}

// Content Sources with chunks
const insertSource = db.prepare(`
  INSERT OR IGNORE INTO content_sources (source_hash, source, indexed_at) VALUES (?, ?, ?)
`);
const insertChunk = db.prepare(`
  INSERT INTO content_chunks (source_id, chunk_index, heading, content, has_code) VALUES (?, ?, ?, ?, ?)
`);

const contentSourcesData = [
  { source: 'context7-react-hooks', chunks: [
    { heading: 'useState', content: 'useState is a React Hook that lets you add a state variable to your component...', code: false },
    { heading: 'useEffect', content: 'useEffect is a React Hook that lets you synchronize a component with an external system...', code: false },
    { heading: 'useCallback', content: 'useCallback is a React Hook that lets you cache a function definition between re-renders...', code: false },
    { heading: 'useMemo', content: 'useMemo is a React Hook that lets you cache the result of a calculation between re-renders...', code: false },
    { heading: 'Example: Counter', content: '```tsx\nconst [count, setCount] = useState(0);\n```', code: true },
  ]},
  { source: 'context7-expo-router', chunks: [
    { heading: 'File-based routing', content: 'Expo Router uses a file-based routing system where each file in the app directory becomes a route...', code: false },
    { heading: 'Layout routes', content: 'Layout routes wrap child routes with shared UI like headers, tab bars, and drawers...', code: false },
    { heading: 'Navigation example', content: '```tsx\nimport { Link } from "expo-router";\n<Link href="/settings">Settings</Link>\n```', code: true },
  ]},
  { source: 'context7-flashlist', chunks: [
    { heading: 'Migration from FlatList', content: 'FlashList is a drop-in replacement for FlatList. The key difference is estimatedItemSize...', code: false },
    { heading: 'Performance tips', content: 'Set estimatedItemSize accurately. Use getItemType for heterogeneous lists. Avoid inline styles...', code: false },
  ]},
];

const crypto = require('crypto');
const insertContentAll = db.transaction(() => {
  for (let i = 0; i < contentSourcesData.length; i++) {
    const cs = contentSourcesData[i];
    const hash = crypto.createHash('sha256').update(cs.source).digest('hex');
    insertSource.run(hash, cs.source, now - (i * DAY));
    const srcRow = db.prepare('SELECT id FROM content_sources WHERE source_hash = ?').get(hash);
    if (srcRow) {
      for (let j = 0; j < cs.chunks.length; j++) {
        const ch = cs.chunks[j];
        insertChunk.run(srcRow.id, j, ch.heading, ch.content, ch.code ? 1 : 0);
      }
    }
  }
});
try { insertContentAll(); } catch {}

// Update budget settings to show meaningful data
try {
  db.prepare('UPDATE budget_settings SET session_limit = 100000 WHERE id = 1').run();
} catch {}

console.log(`context-mem demo: Inserted ${totalInserted} observations across ${sessions.length} sessions`);
console.log(`  + ${knowledgeEntries.length} knowledge entries`);
console.log(`  + ${eventTypes.length} events`);
console.log(`  + ${Math.min(4, sessions.length)} snapshots`);
console.log(`  + ${contentSourcesData.length} content sources (${contentSourcesData.reduce((s, c) => s + c.chunks.length, 0)} chunks)`);
console.log(`  Database: ${dbPath}`);
console.log(`  Run "context-mem dashboard" to view`);
