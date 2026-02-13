import { Injectable } from '@nestjs/common';

import { batchFetchImplementation } from '@jrmdayn/googleapis-batcher';
import { type gmail_v1 as gmailV1, google } from 'googleapis';
import { isDefined } from 'twenty-shared/utils';

import { OAuth2ClientManagerService } from 'src/modules/connected-account/oauth2-client-manager/services/oauth2-client-manager.service';
import { type ConnectedAccountWorkspaceEntity } from 'src/modules/connected-account/standard-objects/connected-account.workspace-entity';
import {
  type MessageChannelWorkspaceEntity,
  MessageFolderImportPolicy,
} from 'src/modules/messaging/common/standard-objects/message-channel.workspace-entity';
import { GmailMessagesImportErrorHandler } from 'src/modules/messaging/message-import-manager/drivers/gmail/services/gmail-messages-import-error-handler.service';
import { filterGmailMessagesBySyncedFolders } from 'src/modules/messaging/message-import-manager/drivers/gmail/utils/filter-gmail-messages-by-synced-folders.util';
import { getSyncedFolderExternalIds } from 'src/modules/messaging/message-import-manager/drivers/gmail/utils/get-synced-folder-external-ids.util';
import { parseAndFormatGmailMessage } from 'src/modules/messaging/message-import-manager/drivers/gmail/utils/parse-and-format-gmail-message.util';
import { type MessageWithParticipants } from 'src/modules/messaging/message-import-manager/types/message';

const GMAIL_BATCH_REQUEST_MAX_SIZE = 50;

@Injectable()
export class GmailGetMessagesService {
  constructor(
    private readonly oAuth2ClientManagerService: OAuth2ClientManagerService,
    private readonly gmailMessagesImportErrorHandler: GmailMessagesImportErrorHandler,
  ) {}

  async getMessages(
    messageIds: string[],
    connectedAccount: Pick<
      ConnectedAccountWorkspaceEntity,
      | 'provider'
      | 'accessToken'
      | 'refreshToken'
      | 'id'
      | 'handle'
      | 'handleAliases'
    >,
    messageChannel: Pick<
      MessageChannelWorkspaceEntity,
      'messageFolders' | 'messageFolderImportPolicy'
    >,
  ): Promise<MessageWithParticipants[]> {
    const oAuth2Client =
      await this.oAuth2ClientManagerService.getGoogleOAuth2Client(
        connectedAccount,
      );

    const batchedFetchImplementation = batchFetchImplementation({
      maxBatchSize: GMAIL_BATCH_REQUEST_MAX_SIZE,
    });

    const batchedGmailClient = google.gmail({
      version: 'v1',
      auth: oAuth2Client,
      fetchImplementation: batchedFetchImplementation,
    });

    const messagePromises = messageIds.map((messageId) =>
      batchedGmailClient.users.messages
        .get({
          userId: 'me',
          id: messageId,
        })
        .then((response) => ({ messageId, data: response.data, error: null }))
        .catch((error) => ({ messageId, data: null, error })),
    );

    const results = await Promise.all(messagePromises);

    const messages = results
      .map(({ messageId, data, error }) => {
        if (error) {
          this.gmailMessagesImportErrorHandler.handleError(error, messageId);

          return undefined;
        }

        return parseAndFormatGmailMessage(
          data as gmailV1.Schema$Message,
          connectedAccount,
        );
      })
      .filter(isDefined);

    if (
      messageChannel.messageFolderImportPolicy ===
      MessageFolderImportPolicy.ALL_FOLDERS
    ) {
      return messages;
    }

    const syncedFolderExternalIds = getSyncedFolderExternalIds(
      messageChannel.messageFolders ?? [],
    );

    if (syncedFolderExternalIds.length === 0) {
      return [];
    }

    const syncedFolderExternalIdSet = new Set(syncedFolderExternalIds);

    const trackedThreadExternalIds = await this.getTrackedThreadExternalIds(
      messages,
      syncedFolderExternalIdSet,
      batchedGmailClient,
    );

    return filterGmailMessagesBySyncedFolders(
      messages,
      syncedFolderExternalIds,
      trackedThreadExternalIds,
    );
  }

  private async getTrackedThreadExternalIds(
    messages: MessageWithParticipants[],
    syncedFolderExternalIdSet: Set<string>,
    gmailClient: gmailV1.Gmail,
  ): Promise<Set<string> | undefined> {
    const hasAnySyncedLabel = (labelIds: string[]) => {
      return labelIds.some((labelId) => syncedFolderExternalIdSet.has(labelId));
    };

    const threadIdsToFetch = new Set(
      messages
        .filter(
          (message) =>
            message.externalId !== message.messageThreadExternalId &&
            !hasAnySyncedLabel(message.labelIds ?? []),
        )
        .map((message) => message.messageThreadExternalId),
    );

    if (threadIdsToFetch.size === 0) {
      return undefined;
    }

    const results = await Promise.all(
      [...threadIdsToFetch].map((threadId) =>
        gmailClient.users.threads
          .get({ userId: 'me', id: threadId, format: 'minimal' })
          .then((response) => ({
            threadId,
            messages: response.data.messages,
          }))
          .catch(() => ({ threadId, messages: null })),
      ),
    );

    const trackedThreadExternalIds = new Set(
      results
        .filter(({ messages: threadMessages }) =>
          threadMessages?.some((msg) => hasAnySyncedLabel(msg.labelIds ?? [])),
        )
        .map(({ threadId }) => threadId),
    );

    return trackedThreadExternalIds.size > 0
      ? trackedThreadExternalIds
      : undefined;
  }
}
