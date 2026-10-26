import { Stack, Text, UnstyledButton } from '@mantine/core';
import {
  IconCalendarEvent,
  IconDots,
  IconFileSpreadsheet,
} from '@tabler/icons-react';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, Outlet, useLocation } from 'react-router-dom';
import classes from './Layout.module.css';

const TABS = [
  {
    to: '/',
    label: 'Визиты',
    icon: IconCalendarEvent,
    isActive: (p: string) =>
      p === '/' || p.startsWith('/day/') || p === '/search',
  },
  {
    to: '/report',
    label: 'Отчёт',
    icon: IconFileSpreadsheet,
    isActive: (p: string) => p.startsWith('/report'),
  },
  {
    to: '/more',
    label: 'Ещё',
    icon: IconDots,
    isActive: (p: string) => p.startsWith('/more'),
  },
];

const DockSlot = createContext<HTMLElement | null>(null);

/**
 * Кнопки страницы над нижним меню («Врач» / «Аптека»): висят над контентом на
 * прозрачном фоне, а под конец страницы добавляется место ровно их высоты.
 */
export function DockActions({ children }: { children: ReactNode }) {
  const slot = useContext(DockSlot);
  return slot ? createPortal(children, slot) : null;
}

/**
 * Страница + нижняя панель. Меню — не fixed поверх контента, а sticky в конце
 * колонки: занимает своё место при любой высоте (крупный шрифт, полоса жестов).
 * Кнопки страницы — прозрачные над ним; их высоту меряем на устройстве и
 * отдаём странице отступом снизу, поэтому последний элемент не прячется.
 */
export function Layout() {
  const { pathname } = useLocation();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [actionsHeight, setActionsHeight] = useState(0);

  useEffect(() => {
    if (!slot) return;
    const ro = new ResizeObserver(() => setActionsHeight(slot.offsetHeight));
    ro.observe(slot);
    return () => ro.disconnect();
  }, [slot]);

  return (
    <DockSlot.Provider value={slot}>
      <div className={classes.shell}>
        <main
          className={classes.main}
          style={{
            paddingBottom: actionsHeight || 'var(--mantine-spacing-md)',
          }}
        >
          <Outlet />
        </main>
        <div className={classes.dock}>
          <div ref={setSlot} className={classes.actions} />
          <nav className={classes.tabs}>
            {TABS.map(({ to, label, icon: Icon, isActive }) => (
              <UnstyledButton
                key={to}
                component={Link}
                to={to}
                className={classes.tab}
                data-active={isActive(pathname) || undefined}
              >
                <Stack gap={2} align="center">
                  <Icon size={26} stroke={1.8} />
                  <Text size="xs" fw={600}>
                    {label}
                  </Text>
                </Stack>
              </UnstyledButton>
            ))}
          </nav>
        </div>
      </div>
    </DockSlot.Provider>
  );
}
