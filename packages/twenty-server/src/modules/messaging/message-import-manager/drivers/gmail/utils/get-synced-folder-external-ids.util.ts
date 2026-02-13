export const getSyncedFolderExternalIds = (
  folders: { isSynced: boolean; externalId: string | null }[],
): string[] =>
  folders.flatMap((folder) => {
    if (!folder.isSynced) {
      return [];
    }

    if (folder.externalId === null || folder.externalId.length === 0) {
      return [];
    }

    return [folder.externalId];
  });
