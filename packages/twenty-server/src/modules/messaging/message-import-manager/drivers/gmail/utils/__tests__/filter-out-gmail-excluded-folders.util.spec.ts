import { filterGmailMessagesBySyncedFolders } from 'src/modules/messaging/message-import-manager/drivers/gmail/utils/filter-gmail-messages-by-synced-folders.util';
import { getSyncedFolderExternalIds } from 'src/modules/messaging/message-import-manager/drivers/gmail/utils/get-synced-folder-external-ids.util';
import { type MessageWithParticipants } from 'src/modules/messaging/message-import-manager/types/message';

const createMessage = (
  externalId: string,
  labelIds: string[],
): MessageWithParticipants =>
  ({ externalId, labelIds }) as MessageWithParticipants;

const createFolder = (externalId: string, isSynced: boolean) => ({
  externalId,
  isSynced,
});

describe('filterGmailMessagesBySyncedFolders', () => {
  describe('only custom labels synced', () => {
    const CRM_LABEL = 'Label_CRM';
    const DEALS_LABEL = 'Label_Deals';

    it('includes message with synced label even if it also has non-synced labels', () => {
      const messages = [
        createMessage('1', [
          CRM_LABEL,
          DEALS_LABEL,
          'IMPORTANT',
          'CATEGORY_PERSONAL',
          'INBOX',
        ]),
        createMessage('2', ['IMPORTANT', 'CATEGORY_PERSONAL', 'INBOX']),
        createMessage('3', ['SENT']),
      ];

      const folders = [
        createFolder('INBOX', false),
        createFolder('SENT', false),
        createFolder('IMPORTANT', false),
        createFolder(CRM_LABEL, true),
        createFolder(DEALS_LABEL, true),
      ];

      const result = filterGmailMessagesBySyncedFolders(
        messages,
        getSyncedFolderExternalIds(folders),
      );

      expect(result.map((m) => m.externalId)).toEqual(['1']);
    });

    it('ignores all category labels for custom folders', () => {
      const messages = [
        createMessage('1', [CRM_LABEL, 'CATEGORY_PROMOTIONS']),
        createMessage('2', [CRM_LABEL, 'CATEGORY_SOCIAL']),
        createMessage('3', [CRM_LABEL, 'CATEGORY_FORUMS']),
        createMessage('4', [CRM_LABEL, 'CATEGORY_UPDATES']),
        createMessage('5', [CRM_LABEL, 'CATEGORY_PERSONAL']),
      ];

      const result = filterGmailMessagesBySyncedFolders(
        messages,
        getSyncedFolderExternalIds([createFolder(CRM_LABEL, true)]),
      );

      expect(result).toHaveLength(5);
    });
  });

  describe('only system folders synced (INBOX/SENT/IMPORTANT)', () => {
    it('excludes promotional/social/forums/updates from INBOX', () => {
      const messages = [
        createMessage('1', ['INBOX']),
        createMessage('2', ['INBOX', 'CATEGORY_PROMOTIONS']),
        createMessage('3', ['INBOX', 'CATEGORY_SOCIAL']),
        createMessage('4', ['INBOX', 'CATEGORY_FORUMS']),
        createMessage('5', ['INBOX', 'CATEGORY_UPDATES']),
      ];

      const result = filterGmailMessagesBySyncedFolders(
        messages,
        getSyncedFolderExternalIds([createFolder('INBOX', true)]),
      );

      expect(result.map((m) => m.externalId)).toEqual(['1']);
    });

    it('does NOT exclude CATEGORY_PERSONAL (intentionally allowed)', () => {
      const messages = [
        createMessage('1', ['INBOX', 'CATEGORY_PERSONAL']),
        createMessage('2', ['INBOX', 'CATEGORY_PROMOTIONS']),
      ];

      const result = filterGmailMessagesBySyncedFolders(
        messages,
        getSyncedFolderExternalIds([createFolder('INBOX', true)]),
      );

      expect(result.map((m) => m.externalId)).toEqual(['1']);
    });

    it('applies category exclusions to SENT folder', () => {
      const messages = [
        createMessage('1', ['SENT']),
        createMessage('2', ['SENT', 'CATEGORY_PROMOTIONS']),
      ];

      const result = filterGmailMessagesBySyncedFolders(
        messages,
        getSyncedFolderExternalIds([createFolder('SENT', true)]),
      );

      expect(result.map((m) => m.externalId)).toEqual(['1']);
    });

    it('applies category exclusions to IMPORTANT folder', () => {
      const messages = [
        createMessage('1', ['IMPORTANT']),
        createMessage('2', ['IMPORTANT', 'CATEGORY_SOCIAL']),
      ];

      const result = filterGmailMessagesBySyncedFolders(
        messages,
        getSyncedFolderExternalIds([createFolder('IMPORTANT', true)]),
      );

      expect(result.map((m) => m.externalId)).toEqual(['1']);
    });
  });

  describe('STARRED folder synced (not a category-exclusion folder)', () => {
    it('does NOT apply category exclusions to STARRED', () => {
      const messages = [
        createMessage('1', ['STARRED']),
        createMessage('2', ['STARRED', 'CATEGORY_PROMOTIONS']),
        createMessage('3', ['STARRED', 'CATEGORY_SOCIAL']),
      ];

      const result = filterGmailMessagesBySyncedFolders(
        messages,
        getSyncedFolderExternalIds([createFolder('STARRED', true)]),
      );

      expect(result).toHaveLength(3);
    });
  });

  describe('mixed: custom label + system folder synced', () => {
    const SALES_LABEL = 'Label_Sales';

    it('includes promo email if in custom label, excludes if only in INBOX', () => {
      const messages = [
        createMessage('1', ['INBOX', 'CATEGORY_PROMOTIONS']),
        createMessage('2', ['INBOX', 'CATEGORY_PROMOTIONS', SALES_LABEL]),
        createMessage('3', ['INBOX']),
      ];

      const folders = [
        createFolder('INBOX', true),
        createFolder(SALES_LABEL, true),
      ];

      const result = filterGmailMessagesBySyncedFolders(
        messages,
        getSyncedFolderExternalIds(folders),
      );

      expect(result.map((m) => m.externalId)).toEqual(['2', '3']);
    });

    it('requires message to be in at least one synced folder', () => {
      const messages = [
        createMessage('1', ['TRASH']),
        createMessage('2', [SALES_LABEL]),
        createMessage('3', ['INBOX', 'SPAM']),
      ];

      const folders = [
        createFolder('INBOX', true),
        createFolder(SALES_LABEL, true),
        createFolder('TRASH', false),
        createFolder('SPAM', false),
      ];

      const result = filterGmailMessagesBySyncedFolders(
        messages,
        getSyncedFolderExternalIds(folders),
      );

      expect(result.map((m) => m.externalId)).toEqual(['2', '3']);
    });
  });

  describe('edge cases', () => {
    it('excludes messages not in any synced folder', () => {
      const messages = [
        createMessage('1', ['TRASH']),
        createMessage('2', ['SPAM']),
        createMessage('3', ['DRAFT']),
      ];

      const result = filterGmailMessagesBySyncedFolders(
        messages,
        getSyncedFolderExternalIds([createFolder('INBOX', true)]),
      );

      expect(result).toHaveLength(0);
    });

    it('handles messages with empty labelIds', () => {
      const messages = [createMessage('1', [])];

      const result = filterGmailMessagesBySyncedFolders(
        messages,
        getSyncedFolderExternalIds([createFolder('INBOX', true)]),
      );

      expect(result).toHaveLength(0);
    });

    it('handles empty syncedFolderExternalIds', () => {
      const messages = [createMessage('1', ['INBOX'])];

      const result = filterGmailMessagesBySyncedFolders(messages, []);

      expect(result).toHaveLength(0);
    });

    it('includes reply via trackedThreadExternalIds', () => {
      const messages = [createMessage('reply-1', ['INBOX', 'IMPORTANT'])];

      (
        messages[0] as MessageWithParticipants & {
          messageThreadExternalId: string;
        }
      ).messageThreadExternalId = 'thread-abc';

      const trackedThreads = new Set(['thread-abc']);

      const result = filterGmailMessagesBySyncedFolders(
        messages,
        getSyncedFolderExternalIds([createFolder('Label_Custom', true)]),
        trackedThreads,
      );

      expect(result.map((m) => m.externalId)).toEqual(['reply-1']);
    });
  });
});
