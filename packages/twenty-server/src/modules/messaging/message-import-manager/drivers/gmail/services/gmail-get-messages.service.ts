import { Injectable, Logger } from '@nestjs/common';

import { batchFetchImplementation } from '@jrmdayn/googleapis-batcher';
import { isNonEmptyString } from '@sniptt/guards';
import { type gmail_v1 as gmailV1, google } from 'googleapis';
import { isDefined } from 'twenty-shared/utils';

import { OAuth2ClientManagerService } from 'src/modules/connected-account/oauth2-client-manager/services/oauth2-client-manager.service';
import { type ConnectedAccountWorkspaceEntity } from 'src/modules/connected-account/standard-objects/connected-account.workspace-entity';
import {
  MessageChannelWorkspaceEntity,
  MessageFolderImportPolicy,
} from 'src/modules/messaging/common/standard-objects/message-channel.workspace-entity';
import { MESSAGING_GMAIL_FOLDERS_WITH_CATEGORY_EXCLUSIONS } from 'src/modules/messaging/message-import-manager/drivers/gmail/constants/messaging-gmail-folders-with-category-exclusions.constant';
import { GmailMessagesImportErrorHandler } from 'src/modules/messaging/message-import-manager/drivers/gmail/services/gmail-messages-import-error-handler.service';
import { filterGmailMessagesByFolderPolicy } from 'src/modules/messaging/message-import-manager/drivers/gmail/utils/filter-gmail-messages-by-folder-policy.util';
import { parseAndFormatGmailMessage } from 'src/modules/messaging/message-import-manager/drivers/gmail/utils/parse-and-format-gmail-message.util';
import { type MessageWithParticipants } from 'src/modules/messaging/message-import-manager/types/message';

const GMAIL_BATCH_REQUEST_MAX_SIZE = 50;

@Injectable()
export class GmailGetMessagesService {
  private readonly logger = new Logger(GmailGetMessagesService.name);

  constructor(
    private readonly oAuth2ClientManagerService: OAuth2ClientManagerService,
    private readonly gmailMessagesImportErrorHandler: GmailMessagesImportErrorHandler,
  ) {}

  private async getThreadExternalIdsWithSyncedCustomLabel(
    threadExternalIds: string[],
    syncedCustomFolderExternalIdSet: Set<string>,
    batchedGmailClient: gmailV1.Gmail,
  ): Promise<Set<string>> {
    const threadResponses = await Promise.allSettled(
      threadExternalIds.map((threadExternalId) =>
        batchedGmailClient.users.threads.get({
          userId: 'me',
          id: threadExternalId,
          format: 'minimal',
        }),
      ),
    );

    const threadExternalIdsWithSyncedCustomLabel = new Set<string>();

    for (const [index, threadResponse] of threadResponses.entries()) {
      if (threadResponse.status === 'rejected') {
        this.logger.warn(
          `Gmail: Error fetching thread metadata ${threadExternalIds[index]}: ${JSON.stringify(threadResponse.reason)}`,
        );

        continue;
      }

      const threadHasSyncedCustomLabel = (
        threadResponse.value.data.messages ?? []
      ).some((threadMessage) =>
        (threadMessage.labelIds ?? []).some((labelId) =>
          syncedCustomFolderExternalIdSet.has(labelId),
        ),
      );

      if (threadHasSyncedCustomLabel) {
        threadExternalIdsWithSyncedCustomLabel.add(threadExternalIds[index]);
      }
    }

    return threadExternalIdsWithSyncedCustomLabel;
  }

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

    const filteredMessages = filterGmailMessagesByFolderPolicy(
      messages,
      messageChannel,
    );

    if (
      messageChannel.messageFolderImportPolicy !==
      MessageFolderImportPolicy.SELECTED_FOLDERS
    ) {
      return filteredMessages;
    }

    const syncedCustomFolderExternalIdSet = new Set(
      (messageChannel.messageFolders ?? [])
        .filter((folder) => folder.isSynced)
        .map((folder) => folder.externalId)
        .filter(isNonEmptyString)
        .filter(
          (externalId) =>
            !MESSAGING_GMAIL_FOLDERS_WITH_CATEGORY_EXCLUSIONS.includes(
              externalId,
            ),
        ),
    );

    if (syncedCustomFolderExternalIdSet.size === 0) {
      return filteredMessages;
    }

    const filteredMessageExternalIdSet = new Set(
      filteredMessages.map((message) => message.externalId),
    );

    const candidateMessages = messages.filter(
      (message) =>
        !filteredMessageExternalIdSet.has(message.externalId) &&
        isNonEmptyString(message.messageThreadExternalId),
    );

    if (candidateMessages.length === 0) {
      return filteredMessages;
    }

    const candidateThreadExternalIds = [
      ...new Set(
        candidateMessages.map((message) => message.messageThreadExternalId),
      ),
    ];

    const threadExternalIdsWithSyncedCustomLabel =
      await this.getThreadExternalIdsWithSyncedCustomLabel(
        candidateThreadExternalIds,
        syncedCustomFolderExternalIdSet,
        batchedGmailClient,
      );

    if (threadExternalIdsWithSyncedCustomLabel.size === 0) {
      return filteredMessages;
    }

    return [
      ...filteredMessages,
      ...candidateMessages.filter((message) =>
        threadExternalIdsWithSyncedCustomLabel.has(
          message.messageThreadExternalId,
        ),
      ),
    ];
  }
}
