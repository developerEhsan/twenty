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
          historyTypes: [
            'messagesAdded',
            'messagesDeleted',
            'labelsAdded',
            'labelsRemoved',
          ],
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
    const syncedFolderExternalIdSet = new Set(syncedFolderExternalIds);
    const messagesAdded: string[] = [];
    const messagesDeleted: string[] = [];

    for (const historyEntry of history) {
      messagesAdded.push(...this.getMessageIds(historyEntry.messagesAdded));
      messagesDeleted.push(...this.getMessageIds(historyEntry.messagesDeleted));

      if (syncedFolderExternalIdSet.size > 0) {
        messagesAdded.push(
          ...this.getMessageIdsFromSyncedLabelEvents(
            historyEntry.labelsAdded,
            syncedFolderExternalIdSet,
          ),
        );
      }
    }

    const uniqueAddedMessageIds = new Set(messagesAdded);
    const uniqueDeletedMessageIds = new Set(messagesDeleted);

    return {
      messagesAdded: [...uniqueAddedMessageIds].filter(
        (messageId) => !uniqueDeletedMessageIds.has(messageId),
      ),
      messagesDeleted: [...uniqueDeletedMessageIds].filter(
        (messageId) => !uniqueAddedMessageIds.has(messageId),
      ),
    };
  }

  private getMessageIds(
    events:
      | gmail_v1.Schema$HistoryMessageAdded[]
      | gmail_v1.Schema$HistoryMessageDeleted[]
      | null
      | undefined,
  ): string[] {
    if (!events?.length) {
      return [];
    }

    return events.flatMap((event) => {
      const messageId = event.message?.id;

      if (typeof messageId !== 'string' || messageId.length === 0) {
        return [];
      }

      return [messageId];
    });
  }

  private getMessageIdsFromSyncedLabelEvents(
    labelEvents: gmail_v1.Schema$HistoryLabelAdded[] | null | undefined,
    syncedFolderExternalIdSet: Set<string>,
  ): string[] {
    if (!labelEvents?.length) {
      return [];
    }

    return labelEvents.flatMap((labelEvent) => {
      const shouldTrackEvent = (labelEvent.labelIds ?? []).some((labelId) =>
        syncedFolderExternalIdSet.has(labelId),
      );

      if (!shouldTrackEvent) {
        return [];
      }

      const messageId = labelEvent.message?.id;

      if (typeof messageId !== 'string' || messageId.length === 0) {
        return [];
      }

      return [messageId];
    });
  }
}
