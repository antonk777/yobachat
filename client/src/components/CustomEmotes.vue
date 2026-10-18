<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';

import { parseEmoteName, prepareEmoteFile } from 'yobachat-shared';

import { useWSConnection } from '@/composables/useWSConnection';
import { useSiteEmotesStore } from '@/stores/siteEmotes';

interface DraftFile {
  key: string
  file: File
  preview: string
  name: string
  error: string
}

const props = withDefaults(defineProps<{
  mode?: 'chat' | 'manage';
}>(), {
  mode: 'manage',
});

const MAX_BATCH = 20;

const ws = useWSConnection();
const emotesStore = useSiteEmotesStore();

const drafts = ref<DraftFile[]>([]);
const formError = ref('');
const saving = ref(false);

const pending = computed(() => emotesStore.emotes.filter(emote => emote.status === 'pending'));
const approved = computed(() => emotesStore.emotes.filter(emote => emote.status === 'approved'));

const names = ref<Record<string, string>>({});

function shownName(id: string, name: string): string {
  return names.value[id] ?? name;
}

function setName(id: string, value: string): void {
  names.value = { ...names.value, [id]: value };
}

onUnmounted(() => {
  for (const draft of drafts.value) {
    if (draft.preview) {
      URL.revokeObjectURL(draft.preview);
    }
  }
});

async function onFiles(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  formError.value = '';

  if (files.length === 0) {
    return;
  }

  if (drafts.value.length + files.length > MAX_BATCH) {
    formError.value = `At most ${MAX_BATCH} files at once`;
  }

  const room = MAX_BATCH - drafts.value.length;
  const next = files.slice(0, Math.max(room, 0));

  for (const file of next) {
    const prepared = await prepareEmoteFile(file);
    if (!prepared.ok) {
      drafts.value.push({
        key: `${file.name}-${file.size}-${drafts.value.length}`,
        file,
        preview: '',
        name: '',
        error: prepared.reason === 'dimensions'
          ? 'Larger than 512×512'
          : prepared.reason === 'size'
            ? 'Larger than 512 KB'
            : 'Not a PNG or GIF',
      });
      continue;
    }

    drafts.value.push({
      key: `${prepared.file.name}-${prepared.file.size}-${drafts.value.length}`,
      file: prepared.file,
      preview: URL.createObjectURL(prepared.file),
      name: '',
      error: '',
    });
  }
}

function removeDraft(key: string): void {
  const draft = drafts.value.find(item => item.key === key);
  if (draft?.preview) {
    URL.revokeObjectURL(draft.preview);
  }

  drafts.value = drafts.value.filter(item => item.key !== key);
}

async function submitDrafts(): Promise<void> {
  formError.value = '';
  const ready = drafts.value.filter(item => !item.error);

  if (ready.length === 0) {
    formError.value = 'No valid files to add';
    return;
  }

  const seen = new Set<string>();
  for (const draft of ready) {
    const name = draft.name.trim();
    if (!parseEmoteName(name)) {
      formError.value = 'Each name must be 2–20 letters, digits, or _';
      return;
    }

    const key = name.toLowerCase();
    if (seen.has(key)) {
      formError.value = 'Names in this batch must be different';
      return;
    }

    seen.add(key);
  }

  saving.value = true;
  try {
    const files = await Promise.all(ready.map(async (draft) => ({
      name: draft.name.trim(),
      dataBase64: await fileToBase64(draft.file),
    })));
    ws.addEmotes(files);
    for (const draft of drafts.value) {
      if (draft.preview) {
        URL.revokeObjectURL(draft.preview);
      }
    }
    drafts.value = [];
  } finally {
    saving.value = false;
  }
}

function fileToBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const step = 0x8000;

    for (let index = 0; index < bytes.length; index += step) {
      binary += String.fromCharCode(...bytes.subarray(index, index + step));
    }

    return btoa(binary);
  });
}

function saveName(id: string): void {
  const current = emotesStore.emotes.find(item => item.id === id);
  const name = (names.value[id] ?? current?.name ?? '').trim();
  if (!parseEmoteName(name)) {
    formError.value = 'Name must be 2–20 letters, digits, or _';
    return;
  }

  formError.value = '';
  ws.renameEmote(id, name);
}
</script>

<template>
  <section
    v-if="props.mode === 'manage' || pending.length > 0"
    class="custom-emotes"
    :class="{ 'custom-emotes--chat': props.mode === 'chat' }"
  >
    <h2 v-if="props.mode === 'manage'">Custom emotes</h2>
    <p v-if="formError" class="custom-emotes__error">{{ formError }}</p>

    <template v-if="props.mode === 'chat'">
      <h3>Pending emotes</h3>
      <ul class="custom-emotes__list">
        <li v-for="emote in pending" :key="emote.id" class="custom-emotes__row">
          <img :src="emote.url" :alt="emote.code">
          <div class="custom-emotes__meta">
            <span>{{ emote.authorName }}</span>
          </div>
          <input
            :value="shownName(emote.id, emote.name)"
            maxlength="20"
            @input="setName(emote.id, ($event.target as HTMLInputElement).value)"
          >
          <button type="button" @click="saveName(emote.id)">Save name</button>
          <button type="button" @click="ws.reviewEmote(emote.id, 'approve')">Approve</button>
          <button type="button" @click="ws.reviewEmote(emote.id, 'reject')">Reject</button>
        </li>
      </ul>
    </template>

    <template v-if="props.mode === 'manage'">
      <h3>Approved</h3>
      <p v-if="approved.length === 0" class="custom-emotes__empty">No custom emotes yet</p>
      <ul v-else class="custom-emotes__list">
        <li v-for="emote in approved" :key="emote.id" class="custom-emotes__row">
          <img :src="emote.url" :alt="emote.code">
          <input
            :value="shownName(emote.id, emote.name)"
            maxlength="20"
            @input="setName(emote.id, ($event.target as HTMLInputElement).value)"
          >
          <button type="button" @click="saveName(emote.id)">Save name</button>
          <button type="button" @click="ws.deleteEmote(emote.id)">Delete</button>
        </li>
      </ul>

      <h3>Add files</h3>
      <label class="custom-emotes__pick">
        Choose PNG or GIF files
        <input type="file" accept="image/png,image/gif" multiple @change="onFiles">
      </label>
      <ul v-if="drafts.length" class="custom-emotes__list">
        <li v-for="draft in drafts" :key="draft.key" class="custom-emotes__row">
          <img v-if="draft.preview" :src="draft.preview" alt="">
          <input v-model="draft.name" maxlength="20" placeholder="Name">
          <span v-if="draft.error" class="custom-emotes__error">{{ draft.error }}</span>
          <button type="button" @click="removeDraft(draft.key)">Remove</button>
        </li>
      </ul>
      <button type="button" :disabled="saving || drafts.length === 0" @click="submitDrafts">
        Add emotes
      </button>
    </template>
  </section>
</template>

<style scoped>
.custom-emotes {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 1rem 1.25rem 2rem;
}

.custom-emotes--chat {
  flex: none;
  overflow: visible;
  margin-top: 0.5rem;
  padding: 0.75rem var(--spacing) 0.25rem;
  border-top: 1px solid var(--border-color);
}

.custom-emotes--chat h3 {
  margin-top: 0;
}

h2,
h3 {
  margin: 0 0 0.75rem;
}

h3 {
  margin-top: 1.5rem;
}

.custom-emotes__empty {
  color: var(--text-muted);
}

.custom-emotes__error {
  color: var(--error-color);
}

.custom-emotes__list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.custom-emotes__row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.custom-emotes__row img {
  width: 32px;
  height: 32px;
  object-fit: contain;
  background: var(--bg-color-bright);
}

.custom-emotes__meta {
  display: flex;
  flex-direction: column;
  min-width: 8rem;
}

.custom-emotes__meta span {
  color: var(--text-muted);
  font-size: 0.85rem;
}

input {
  border: 1px solid var(--border-color);
  border-radius: 0.35rem;
  background: var(--bg-color);
  color: var(--text-color);
  padding: 0.35rem 0.5rem;
}

button,
.custom-emotes__pick {
  border: 1px solid var(--border-color);
  border-radius: 0.35rem;
  background: var(--bg-color-bright);
  color: var(--text-color);
  padding: 0.35rem 0.6rem;
  cursor: pointer;
}

.custom-emotes__pick {
  position: relative;
  display: flex;
  width: fit-content;
  margin-bottom: 0.6rem;
}

.custom-emotes__pick input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
  background: transparent;
}

button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
