// Golos Text — шрифт, сделанный под кириллицу и интерфейсы; лежит в самом
// приложении (не Google Fonts), чтобы работал без сети. Включает казахские буквы.
import '@fontsource/golos-text/400.css';
import '@fontsource/golos-text/500.css';
import '@fontsource/golos-text/600.css';
import '@fontsource/golos-text/700.css';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './global.css';

import { createTheme, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { UnauthorizedError } from './api/client';
import { invalidateReportChecks, keys } from './api/queries';
import { App } from './App';
import { onLocalChange } from './offline/sync';

// Пользователь — в 50+, телефон в одной руке на ходу: всё крупнее обычного.
const theme = createTheme({
  primaryColor: 'cyan',
  primaryShade: 8,
  defaultRadius: 'md',
  fontFamily:
    '"Golos Text", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  headings: {
    fontFamily:
      '"Golos Text", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  },
  fontSizes: { xs: '14px', sm: '16px', md: '18px', lg: '20px', xl: '24px' },
  components: {
    Button: { defaultProps: { size: 'md' } },
    Badge: { defaultProps: { tt: 'none' } },
    TextInput: { defaultProps: { size: 'md' } },
    PasswordInput: { defaultProps: { size: 'md' } },
    Autocomplete: { defaultProps: { size: 'md' } },
    Textarea: { defaultProps: { size: 'md' } },
    NumberInput: { defaultProps: { size: 'md' } },
  },
});

// Сессия кончилась посреди работы — любой запрос переводит на экран входа.
const onError = (e: Error) => {
  if (e instanceof UnauthorizedError) queryClient.setQueryData(keys.me, null);
};
const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    // большая часть данных — из памяти телефона: запросы не ждут сеть,
    // а то, что идёт на сервер, само обрабатывает её отсутствие
    queries: {
      networkMode: 'always',
      retry: (count, e) => !(e instanceof UnauthorizedError) && count < 2,
      staleTime: 30_000,
    },
    mutations: { networkMode: 'always' },
  },
});

// память телефона поменялась (сохранили визит, пришло с сервера) — перечитать
onLocalChange(({ serverChanged }) => {
  void queryClient.invalidateQueries({ queryKey: keys.local });
  if (serverChanged) {
    void queryClient.invalidateQueries({ queryKey: ['plan'] });
    void invalidateReportChecks(queryClient);
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications position="top-center" autoClose={2500} limit={2} />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
