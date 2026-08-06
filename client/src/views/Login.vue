<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useAuth } from '@/composables/useAuth';

const auth = useAuth();
const error = ref<string | null>(null);
const isLoading = ref(true);

onMounted(async () => {
  const { ok } = await auth.ensureAuthenticated();

  if (ok) {
    window.location.href = '/admin';
    return;
  }

  error.value = 'Local admin login failed. Is the server running with secure: false?';
  isLoading.value = false;
});

async function handleLocalLogin() {
  isLoading.value = true;
  error.value = null;

  const { ok } = await auth.ensureAuthenticated();

  if (ok) {
    window.location.href = '/admin';
    return;
  }

  error.value = 'Local admin login failed.';
  isLoading.value = false;
}
</script>

<template>
  <div class="login-screen">
    <div class="login-content">
      <h1 class="login-title">yobachat</h1>
      <p class="login-description">Local admin — no Twitch login required</p>

      <div v-if="error" class="login-error">
        {{ error }}
      </div>

      <button
        class="btn login-button"
        :class="isLoading ? 'btn-secondary' : 'btn-primary'"
        @click="handleLocalLogin"
        :disabled="isLoading"
      >
        {{ isLoading ? 'Loading...' : 'Enter admin' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.login-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100dvh;
  background-color: var(--bg-color-dark);
  color: var(--text-color);
}

.login-content {
  text-align: center;
  padding: 2rem;
  max-width: 400px;
}

.login-title {
  font-size: 2rem;
  margin-bottom: 1rem;
  font-weight: 700;
}

.login-description {
  margin-bottom: 2rem;
  color: var(--text-muted);
}

.login-error {
  margin-bottom: 1rem;
  padding: 1rem;
  background-color: var(--error-color);
  color: white;
  border-radius: 0.25rem;
  font-size: 0.9rem;
}

.login-button {
  margin-inline: auto;
  padding: 1rem 2rem;
  font-size: 1.1rem;
  min-width: 200px;
  text-align: center;
}

.login-button:disabled {
  cursor: not-allowed;
  background-color: var(--bg-color-dark);
}
</style>
