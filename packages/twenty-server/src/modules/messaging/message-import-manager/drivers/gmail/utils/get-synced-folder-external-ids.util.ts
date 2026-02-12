export const getSyncedFolderExternalIds = (
  folders: { isSynced: boolean; externalId: string | null }[],
): string[] =>
  folders
    .filter(
      (folder): folder is typeof folder & { externalId: string } =>
        folder.isSynced && folder.externalId !== null,
    )
    .map((folder) => folder.externalId);
