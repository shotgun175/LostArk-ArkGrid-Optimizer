<script lang="ts">
  import { DEFAULT_PROFILE_NAME } from '../../lib/constants/enums';
  import { L_DEFAULT_PROFILE_NAME } from '../../lib/constants/localization';
  import {
    addNewProfile,
    appConfig,
    bigIntSerializer,
    getProfile,
  } from '../../lib/state/appConfig.state.svelte';
  import { appLocale } from '../../lib/state/locale.state.svelte';
  import {
    type CharacterProfile,
    currentProfileName,
    deleteProfile,
    imgRoleCombat,
    imgRoleSupporter,
    initNewProfile,
    migrateProfile,
    setCurrentProfileName,
    updateProfileCharacterName,
  } from '../../lib/state/profile.state.svelte';

  let locale = $derived(appLocale.current);
  const LTitle = $derived(
    {
      en_us: 'Profile',
    }[locale]
  );
  const LAddNewProfile = $derived(
    {
      en_us: 'Enter a name for the new profile.',
    }[locale]
  );
  const LNewProfile = $derived(
    {
      en_us: 'Create Profile',
    }[locale]
  );
  const LNewProfileFailedMsg = $derived(
    {
      en_us: 'A profile with this name already exists, or the name is longer than 16 characters.',
    }[locale]
  );
  const LConfirmDeleteProfile: Record<string, (profileName: string) => string> = {
    en_us: (name) => `Are you sure you want to delete the "${name}" profile?`,
  };
  const LDeleteProfile = $derived(
    {
      en_us: 'Delete current profile',
    }[locale]
  );
  const LEditProfile = $derived(
    {
      en_us: 'Edit current profile',
    }[locale]
  );
  const LEditProfileMsg = $derived(
    {
      en_us: 'Enter a new name for the profile.',
    }[locale]
  );
  const LEditProfileFailedMsg = $derived(
    {
      en_us: 'A profile with this name already exists, or the name is longer than 16 characters.',
    }[locale]
  );
  const LExportProfile = $derived(
    {
      en_us: 'Export current profile as JSON',
    }[locale]
  );
  const LImportProfile = $derived(
    {
      en_us: 'Import profile from JSON',
    }[locale]
  );
  const LImportProfileFailedMsgDuplicated = $derived(
    {
      en_us: 'A profile with this name already exists.',
    }[locale]
  );
  const LImportProfileFailedMsgWrongFormat = $derived(
    {
      en_us: 'Failed to import the profile file due to an invalid file format.',
    }[locale]
  );
</script>

<div class="root">
  <div class="title">👤 {LTitle}</div>
  <div class="buttons">
    {#each appConfig.current.characterProfiles as profile}
      <button
        class="profile-select-button"
        onclick={() => setCurrentProfileName(profile.characterName)}
        class:active={profile.characterName === currentProfileName.current}
      >
        {profile.characterName === DEFAULT_PROFILE_NAME
          ? L_DEFAULT_PROFILE_NAME[locale]
          : profile.characterName}
        {#if profile.characterName !== DEFAULT_PROFILE_NAME}
          {#if profile.dualRole}
            <span class="role-both" aria-label="DPS and Support (Both) role">
              <img src={imgRoleCombat} alt="" />
              <img src={imgRoleSupporter} alt="" />
            </span>
          {:else}
            <img
              src={profile.activeBuild === 'support' ? imgRoleSupporter : imgRoleCombat}
              alt={profile.activeBuild === 'support' ? 'Support role' : 'DPS role'}
            />
          {/if}
        {/if}
      </button>
    {/each}
    <button
      title={LNewProfile}
      onclick={() => {
        const profileName = window.prompt(LAddNewProfile)?.trim();
        if (profileName === undefined || profileName.length == 0) return;
        if (!addNewProfile(initNewProfile(profileName))) {
          window.alert(LNewProfileFailedMsg);
          return;
        }
        setCurrentProfileName(profileName);
      }}>➕</button
    >
    <button
      title={LEditProfile}
      disabled={currentProfileName.current === DEFAULT_PROFILE_NAME}
      onclick={() => {
        // Pre-fill the current name so the user can tweak it instead of retyping the whole thing.
        const profileName = window.prompt(LEditProfileMsg, currentProfileName.current)?.trim();
        if (profileName === undefined || profileName.length == 0) return;
        // Confirming the unchanged name is a no-op (avoids a false "already exists" on self-match).
        if (profileName === currentProfileName.current) return;
        if (updateProfileCharacterName(profileName) === false) {
          window.alert(LEditProfileFailedMsg);
          return;
        }
        setCurrentProfileName(profileName);
      }}>✏️</button
    >
    <button
      title={LDeleteProfile}
      onclick={() => {
        if (window.confirm(LConfirmDeleteProfile[locale](currentProfileName.current))) {
          deleteProfile(currentProfileName.current);
        }
      }}
      disabled={currentProfileName.current === DEFAULT_PROFILE_NAME}>🗑️</button
    >
    <button
      title={LExportProfile}
      disabled={currentProfileName.current === DEFAULT_PROFILE_NAME}
      onclick={() => {
        const jsonStr = bigIntSerializer.stringify(getProfile(currentProfileName.current));

        // 2. Create the Blob
        const blob = new Blob([jsonStr], { type: 'application/json' });

        // 3. Create the download link
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentProfileName.current}.json`;
        document.body.appendChild(a);
        a.click();

        // 4. Clean up
        a.remove();
        URL.revokeObjectURL(url);
      }}>💾</button
    >
    <button
      title={LImportProfile}
      onclick={() => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json'; // Only JSON files can be selected

        // 2. Handle the file after selection
        fileInput.addEventListener('change', (event) => {
          const target = event.target as HTMLInputElement; // Type assertion here
          const file = target.files?.[0]; // Optional chaining for safety
          if (!file) return;

          const reader = new FileReader();
          reader.onload = (e) => {
            try {
              const data: CharacterProfile = bigIntSerializer.parse(e.target?.result as string);
              migrateProfile(data);
              if (addNewProfile(data)) {
                currentProfileName.current = data.characterName;
              } else {
                alert(LImportProfileFailedMsgDuplicated);
              }
            } catch (err) {
              alert(LImportProfileFailedMsgWrongFormat);
            }
          };
          reader.readAsText(file);
          // 3. Remove the input
          fileInput.remove();
        });
        // 4. Click to open the file picker
        fileInput.click();
      }}
    >
      📂
    </button>
  </div>
</div>

<style>
  .root {
    display: flex;
    flex-direction: row;
    gap: 10px;
    align-items: center;
    user-select: none;
    flex-wrap: wrap;
  }
  .title {
    font-weight: 700;
    font-size: 1.4rem;
  }
  .profile-select-button {
    /* A bit larger to distinguish it from the add and delete buttons */
    height: 2.6rem;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.2rem;
    box-sizing: border-box;
  }
  .profile-select-button > img {
    height: 1.2rem;
    box-sizing: border-box;
  }
  /* 'Both' role: the two icons overlapped slightly so it reads as one blended marker. */
  .role-both {
    display: inline-flex;
    align-items: center;
  }
  .role-both > img {
    height: 1.2rem;
    box-sizing: border-box;
  }
  .role-both > img:last-child {
    margin-left: -0.35rem;
  }
  .buttons {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  button {
    background-color: var(--card);
  }
  button:hover {
    background-color: var(--card-inner);
  }
  button.active {
    background-color: var(--card-inner);
    font-weight: bold;
    border: 2px solid;
  }
</style>
