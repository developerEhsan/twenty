import { getSyncedFolderExternalIds } from 'src/modules/messaging/message-import-manager/drivers/gmail/utils/get-synced-folder-external-ids.util';

describe('getSyncedFolderExternalIds', () => {
  it('returns only synced folder external IDs', () => {
    const result = getSyncedFolderExternalIds([
      { isSynced: true, externalId: 'INBOX' },
      { isSynced: false, externalId: 'Label_work' },
      { isSynced: true, externalId: 'Label_sales' },
    ]);

    expect(result).toEqual(['INBOX', 'Label_sales']);
  });

  it('ignores null and empty external IDs', () => {
    const result = getSyncedFolderExternalIds([
      { isSynced: true, externalId: null },
      { isSynced: true, externalId: '' },
      { isSynced: true, externalId: 'INBOX' },
    ]);

    expect(result).toEqual(['INBOX']);
  });
});
