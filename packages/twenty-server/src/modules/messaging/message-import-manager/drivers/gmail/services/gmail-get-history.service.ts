import { Injectable } from '@nestjs/common';

import { type gmail_v1 } from 'googleapis';

import { MESSAGING_GMAIL_USERS_HISTORY_MAX_RESULT } from 'src/modules/messaging/message-import-manager/drivers/gmail/constants/messaging-gmail-users-history-max-result.constant';
import { GmailMessageListFetchErrorHandler } from 'src/modules/messaging/message-import-manager/drivers/gmail/services/gmail-message-list-fetch-error-handler.service';

const MESSAGING_GMAIL_HISTORY_EVENT_TYPES: (
  | 'messageAdded'
  | 'messageDeleted'
  | 'labelAdded'
  | 'labelRemoved'
)[] = ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'];

@Injectable()
export class GmailGetHistoryService {
  constructor(
    private readonly gmailMessageListFetchErrorHandler: GmailMessageListFetchErrorHandler,
  ) {}

  public async getHistory(
    gmailClient: gmail_v1.Gmail,
    lastSyncHistoryId: string,
  ): Promise<{
    history: gmail_v1.Schema$History[];
    historyId?: string | null;
  }> {
    const fullHistory: gmail_v1.Schema$History[] = [];
    let pageToken: string | undefined;
    let hasMoreMessages = true;
    let nextHistoryId: string | undefined;

    while (hasMoreMessages) {
      const response = await gmailClient.users.history
        .list({
          userId: 'me',
          maxResults: MESSAGING_GMAIL_USERS_HISTORY_MAX_RESULT,
          pageToken,
          startHistoryId: lastSyncHistoryId,
          historyTypes: MESSAGING_GMAIL_HISTORY_EVENT_TYPES,
        })
        .catch((error) => {
          this.gmailMessageListFetchErrorHandler.handleError(error);

          return {
            data: {
              history: [],
              historyId: lastSyncHistoryId,
              nextPageToken: undefined,
            },
          };
        });

      nextHistoryId = response?.data?.historyId ?? undefined;

      if (response?.data?.history) {
        fullHistory.push(...response.data.history);
      }

      pageToken = response?.data?.nextPageToken ?? undefined;
      hasMoreMessages = !!pageToken;
    }

    return { history: fullHistory, historyId: nextHistoryId };
  }

  public async getMessageIdsFromHistory(
    history: gmail_v1.Schema$History[],
    syncedFolderExternalIds: string[] = [],
  ): Promise<{
    messagesAdded: string[];
    messagesDeleted: string[];
  }> {
    const syncedFolderExternalIdSet = new Set(syncedFolderExternalIds);
    const messagesAdded = new Set<string>();
    const messagesDeleted = new Set<string>();

    for (const historyRecord of history) {
      historyRecord.messagesAdded?.forEach((messageAdded) => {
        if (messageAdded.message?.id) {
          messagesAdded.add(messageAdded.message.id);
        }
      });

      historyRecord.labelsAdded?.forEach((labelAdded) => {
        const messageId = labelAdded.message?.id;
        const labelIds = labelAdded.labelIds ?? [];

        if (
          messageId &&
          labelIds.some((labelId) => syncedFolderExternalIdSet.has(labelId))
        ) {
          messagesAdded.add(messageId);
        }
      });

      historyRecord.messagesDeleted?.forEach((messageDeleted) => {
        if (messageDeleted.message?.id) {
          messagesDeleted.add(messageDeleted.message.id);
        }
      });
    }

    const uniqueMessagesAdded = [...messagesAdded].filter(
      (messageId) => !messagesDeleted.has(messageId),
    );

    const uniqueMessagesDeleted = [...messagesDeleted].filter(
      (messageId) => !messagesAdded.has(messageId),
    );

    return {
      messagesAdded: uniqueMessagesAdded,
      messagesDeleted: uniqueMessagesDeleted,
    };
  }
}
