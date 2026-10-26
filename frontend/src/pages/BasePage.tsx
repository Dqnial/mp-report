import {
  ActionIcon,
  Alert,
  Button,
  Center,
  FileButton,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconDownload,
  IconSend,
  IconUpload,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  keys,
  useBaseFile,
  useBaseStatus,
  useSyncStatus,
  useUploadBase,
} from '../api/queries';
import { baseUploadedMessage } from '../baseUploaded';
import { download, shareFile, XLSX_MIME } from '../fileShare';
import { isNative } from '../native';
import { pushOutbox } from '../offline/sync';
import { unsentChanges } from '../plural';

/**
 * «База врачей и аптек»: руководитель присылает файл, приложение вписывает в
 * него врачей и аптеки из справочника (он пополняется с каждым визитом).
 */
export function BasePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const status = useBaseStatus();
  const upload = useUploadBase();
  const sync = useSyncStatus();
  const template = status.data?.template;
  const baseFile = useBaseFile(template?.originalName);
  const [shareFailed, setShareFailed] = useState(false);

  // Справочник пополняет сервер из пришедших визитов: неотправленные — сначала
  // отправить, а когда ушли — пересобрать базу с новыми врачами.
  const unsent = sync.pending;
  const hadUnsent = useRef(false);
  useEffect(() => {
    if (unsent) {
      hadUnsent.current = true;
      void pushOutbox();
    } else if (hadUnsent.current) {
      hadUnsent.current = false;
      void qc.invalidateQueries({ queryKey: keys.base });
    }
  }, [unsent, qc]);

  const fileReady = !!baseFile.data && !baseFile.isFetching;

  const onUpload = (file: File | null) => {
    if (!file) return;
    upload.mutate(file, {
      onSuccess: (b) =>
        notifications.show({
          color: 'teal',
          title: 'Файл базы загружен',
          message: baseUploadedMessage(b),
        }),
    });
  };

  const header = (
    <Group gap="xs" wrap="nowrap">
      <ActionIcon
        variant="subtle"
        size="xl"
        aria-label="Назад"
        onClick={() => navigate('/more')}
      >
        <IconArrowLeft size={26} />
      </ActionIcon>
      <Title order={3}>База врачей и аптек</Title>
    </Group>
  );

  if (status.isError) {
    return (
      <Stack gap="md">
        {header}
        <Alert color="gray" icon={<IconAlertTriangle />}>
          Нет связи с сервером. Базу собирает сервер — отправить её можно, когда
          появится интернет.
        </Alert>
      </Stack>
    );
  }

  if (status.isPending) {
    return (
      <Stack gap="md">
        {header}
        <Center py="xl">
          <Loader />
        </Center>
      </Stack>
    );
  }

  const counts = (
    <Text size="sm" c="dimmed">
      В базу попадут: врачей — {status.data.doctors}, аптек —{' '}
      {status.data.pharmacies}
      {status.data.merged > 0 &&
        `. Повторы одного человека сведены в одну строку: ${status.data.merged}`}
    </Text>
  );

  return (
    <Stack gap="md">
      {header}

      {!template ? (
        <Paper withBorder p="md">
          <Stack>
            <Text>
              Загрузите файл «База врачей и аптек», который прислал
              руководитель. Приложение впишет в него врачей и аптеки из ваших
              визитов.
            </Text>
            {counts}
            <FileButton onChange={onUpload} accept={`.xlsx,${XLSX_MIME}`}>
              {(props) => (
                <Button
                  {...props}
                  size="lg"
                  leftSection={<IconUpload />}
                  loading={upload.isPending}
                >
                  Загрузить файл базы
                </Button>
              )}
            </FileButton>
          </Stack>
        </Paper>
      ) : (
        <>
          <Paper withBorder p="md">
            <Stack gap="xs">
              <Text size="sm" c="dimmed">
                Файл
              </Text>
              <Text fw={500} style={{ wordBreak: 'break-word' }}>
                {template.originalName}
              </Text>
              {counts}
            </Stack>
          </Paper>

          {unsent > 0 && (
            <Alert color="orange" icon={<IconAlertTriangle />}>
              {sync.offline || sync.authRequired
                ? `На телефоне ${unsentChanges(unsent)} — новые врачи из них попадут в базу, когда отправятся.`
                : 'Отправляю визиты с телефона на сервер…'}
            </Alert>
          )}
          {baseFile.isError && (
            <Alert color="red">{baseFile.error.message}</Alert>
          )}

          <Button
            size="xl"
            color="green"
            leftSection={<IconSend size={28} />}
            loading={!fileReady && !baseFile.isError}
            disabled={!fileReady}
            onClick={() => {
              setShareFailed(false);
              if (fileReady) {
                shareFile(baseFile.data, 'Отправить базу', () =>
                  setShareFailed(true),
                );
              }
            }}
          >
            Отправить базу
          </Button>

          {shareFailed && baseFile.data && (
            <Alert color="orange" icon={<IconAlertTriangle />}>
              <Stack gap="xs">
                <Text size="sm">
                  {isNative
                    ? 'Не удалось открыть меню «Поделиться». Попробуйте ещё раз.'
                    : 'На этом устройстве не открылось меню «Поделиться». Можно скачать файл и отправить его вручную.'}
                </Text>
                {!isNative && (
                  <Button
                    variant="light"
                    color="orange"
                    leftSection={<IconDownload size={18} />}
                    onClick={() => download(baseFile.data!)}
                  >
                    Скачать файл
                  </Button>
                )}
              </Stack>
            </Alert>
          )}

          <Group justify="center" gap="xs">
            <FileButton onChange={onUpload} accept={`.xlsx,${XLSX_MIME}`}>
              {(props) => (
                <Button
                  {...props}
                  variant="subtle"
                  size="sm"
                  leftSection={<IconUpload size={18} />}
                  loading={upload.isPending}
                >
                  Заменить файл
                </Button>
              )}
            </FileButton>
            {/* в APK скачивание blob-ссылок WebView не поддерживает */}
            {!isNative && (
              <Button
                variant="subtle"
                size="sm"
                color="gray"
                leftSection={<IconDownload size={18} />}
                disabled={!fileReady}
                onClick={() => fileReady && download(baseFile.data)}
              >
                Скачать файл
              </Button>
            )}
          </Group>
        </>
      )}

      {upload.error && <Alert color="red">{upload.error.message}</Alert>}
    </Stack>
  );
}
