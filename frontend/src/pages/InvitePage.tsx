import {
  Alert,
  Button,
  Center,
  Loader,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { useRegister } from '../api/queries';

/** Регистрация по ссылке-приглашению от админа. */
export function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const register = useRegister();

  const check = useQuery({
    queryKey: ['invite', token],
    queryFn: () =>
      apiFetch(`/auth/invite/${encodeURIComponent(token)}`).then(() => true),
    retry: false,
  });

  const form = useForm({
    initialValues: { fullName: '', login: '', password: '', password2: '' },
    validate: {
      fullName: (v) => (v.trim().length >= 2 ? null : 'Введите ФИО'),
      login: (v) =>
        /^[a-z0-9._-]{3,32}$/i.test(v.trim())
          ? null
          : 'Латиница, цифры, точка, дефис — от 3 символов',
      password: (v) => (v.length >= 8 ? null : 'Минимум 8 символов'),
      password2: (v, all) => (v === all.password ? null : 'Пароли не совпадают'),
    },
  });

  const submit = form.onSubmit(({ fullName, login, password }) =>
    register.mutate(
      { token, fullName, login, password },
      { onSuccess: () => navigate('/', { replace: true }) },
    ),
  );

  return (
    <Center mih="100dvh" p="md">
      <Paper w="100%" maw={420} p="lg" radius="lg" withBorder>
        {check.isPending ? (
          <Center>
            <Loader />
          </Center>
        ) : check.isError ? (
          <Stack>
            <Title order={3}>Приглашение недействительно</Title>
            <Text c="dimmed">
              Ссылка уже использована или устарела. Попросите новую.
            </Text>
          </Stack>
        ) : (
          <form onSubmit={submit}>
            <Stack>
              <Title order={2}>Регистрация</Title>
              <TextInput
                label="ФИО"
                placeholder="Иванов Иван"
                {...form.getInputProps('fullName')}
              />
              <TextInput
                label="Логин"
                autoComplete="username"
                autoCapitalize="none"
                {...form.getInputProps('login')}
              />
              <PasswordInput
                label="Пароль"
                autoComplete="new-password"
                {...form.getInputProps('password')}
              />
              <PasswordInput
                label="Пароль ещё раз"
                autoComplete="new-password"
                {...form.getInputProps('password2')}
              />
              {register.error && (
                <Alert color="red">{register.error.message}</Alert>
              )}
              <Button type="submit" size="lg" loading={register.isPending}>
                Зарегистрироваться
              </Button>
            </Stack>
          </form>
        )}
      </Paper>
    </Center>
  );
}
