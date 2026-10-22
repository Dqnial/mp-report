import { Center, Loader } from '@mantine/core';
import { useEffect, useLayoutEffect } from 'react';
import { notifications } from '@mantine/notifications';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { handleBackButton, listenSharedFiles } from './native';
import { kvSet } from './offline/db';
import { SHARED_FILE_KEY, type SharedFile } from './offline/shared';
import { useMe } from './api/queries';
import { requestPersistentStorage } from './offline/local';
import { startSync } from './offline/sync';
import { Layout } from './components/Layout';
import { DayPage } from './pages/DayPage';
import { InvitePage } from './pages/InvitePage';
import { LoginPage } from './pages/LoginPage';
import { MorePage } from './pages/MorePage';
import { PreviewPage } from './pages/PreviewPage';
import { ReportPage } from './pages/ReportPage';
import { SearchPage } from './pages/SearchPage';
import { VisitPage } from './pages/VisitPage';

export function App() {
  const me = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const userId = me.data?.id;

  // APK: «Назад» и шаблон из WhatsApp → «Поделиться» → «Визиты». Файл кладём
  // туда же, куда его кладёт сервис-воркер в PWA, — экран отчёта заберёт его
  useEffect(() => {
    const offBack = handleBackButton();
    const offShared = listenSharedFiles(
      (file) => {
        const shared: SharedFile = {
          name: file.name,
          type: file.type,
          blob: file,
        };
        void kvSet(SHARED_FILE_KEY, shared).then(() =>
          navigate('/report?shared'),
        );
      },
      (message) => notifications.show({ color: 'red', message }),
    );
    return () => {
      offBack();
      offShared();
    };
  }, [navigate]);

  // Новая страница — с начала. Браузер сам прокрутку между «страницами»
  // приложения не сбрасывает: форма визита открывалась на месте, до которого
  // долистали список. До отрисовки (layout), чтобы не было рывка.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    if (!userId) return;
    startSync(userId);
    void requestPersistentStorage();
  }, [userId]);

  if (me.isPending) {
    return (
      <Center h="100dvh">
        <Loader />
      </Center>
    );
  }

  // приглашение открывается и без входа
  if (location.pathname.startsWith('/invite/')) {
    return (
      <Routes>
        <Route path="/invite/:token" element={<InvitePage />} />
      </Routes>
    );
  }

  if (!me.data) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DayPage />} />
        <Route path="/day/:date" element={<DayPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/report" element={<ReportPage />} />
        <Route path="/report/preview" element={<PreviewPage />} />
        <Route path="/more" element={<MorePage />} />
      </Route>
      {/* форма — на весь экран, без нижнего меню; «Назад» на Android её закрывает */}
      <Route path="/visit/new" element={<VisitPage />} />
      <Route path="/visit/:clientId" element={<VisitPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
