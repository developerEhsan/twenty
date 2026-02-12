import { Injectable } from '@nestjs/common';

import { type gmail_v1 } from 'googleapis';

import { MESSAGING_GMAIL_USERS_HISTORY_MAX_RESULT } from 'src/modules/messaging/message-import-manager/drivers/gmail/constants/messaging-gmail-users-history-max-result.constant';
import { GmailMessageListFetchErrorHandler } from 'src/modules/messaging/message-import-manager/drivers/gmail/services/gmail-message-list-fetch-error-handler.service';

@Injectable()
export class GmailGetHistoryService {
  constructor(
    private readonly gmailMessageListFetchErrorHandler: GmailMessageListFetchErrorHandler,
  ) {}

  public async getHistory(
    gmailClient: gmail_v1.Gmail,
    lastSyncHistoryId: string,
    historyTypes?: (
      | 'messageAdded'
      | 'messageDeleted'
      | 'labelAdded'
      | 'labelRemoved'
    )[],
    labelId?: string,
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
          historyTypes: historyTypes || [
            'messageAdded',
            'messageDeleted',
            'labelAdded',
          ],
          labelId,
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

  public getMessageIdsFromHistory(
    history: gmail_v1.Schema$History[],
    syncedFolderExternalIds: string[] = [],
  ): {
    messagesAdded: string[];
    messagesDeleted: string[];
  } {
    const syncedFolderSet = new Set(syncedFolderExternalIds);

    const messagesAdded = history.flatMap((historyEntry) => {
      const addedIds = (historyEntry.messagesAdded ?? []).map(
        (messageAdded) => messageAdded.message?.id || '',
      );

      const labelAddedIds =
        syncedFolderSet.size > 0
          ? (historyEntry.labelsAdded ?? [])
              .filter((labelEvent) =>
                (labelEvent.labelIds ?? []).some((labelId) =>
                  syncedFolderSet.has(labelId),
                ),
              )
              .filter((labelEvent) => labelEvent.message?.id)
              .map((labelEvent) => labelEvent.message!.id!)
          : [];

      return [...addedIds, ...labelAddedIds];
    });

    const messagesDeleted = history.flatMap((historyEntry) =>
      (historyEntry.messagesDeleted ?? []).map(
        (messageDeleted) => messageDeleted.message?.id || '',
      ),
    );

    const deletedSet = new Set(messagesDeleted);
    const addedSet = new Set(messagesAdded);

    return {
      messagesAdded: messagesAdded.filter(
        (messageId) => !deletedSet.has(messageId),
      ),
      messagesDeleted: messagesDeleted.filter(
        (messageId) => !addedSet.has(messageId),
      ),
    };
  }
}
