import { Test, type TestingModule } from '@nestjs/testing';

import { google } from 'googleapis';
import { ConnectedAccountProvider } from 'twenty-shared/types';

import { OAuth2ClientManagerService } from 'src/modules/connected-account/oauth2-client-manager/services/oauth2-client-manager.service';
import { MessageFolderImportPolicy } from 'src/modules/messaging/common/standard-objects/message-channel.workspace-entity';
import { GmailGetMessagesService } from 'src/modules/messaging/message-import-manager/drivers/gmail/services/gmail-get-messages.service';
import { GmailMessagesImportErrorHandler } from 'src/modules/messaging/message-import-manager/drivers/gmail/services/gmail-messages-import-error-handler.service';
import { parseAndFormatGmailMessage } from 'src/modules/messaging/message-import-manager/drivers/gmail/utils/parse-and-format-gmail-message.util';

jest.mock(
  'src/modules/messaging/message-import-manager/drivers/gmail/utils/parse-and-format-gmail-message.util',
  () => ({
    parseAndFormatGmailMessage: jest.fn(),
  }),
);

describe('GmailGetMessagesService', () => {
  let service: GmailGetMessagesService;
  let oAuth2ClientManagerService: OAuth2ClientManagerService;

  const connectedAccount = {
    provider: ConnectedAccountProvider.GOOGLE,
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    id: 'connected-account-id',
    handle: 'test@gmail.com',
    handleAliases: '',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GmailGetMessagesService,
        {
          provide: OAuth2ClientManagerService,
          useValue: {
            getGoogleOAuth2Client: jest.fn(),
          },
        },
        {
          provide: GmailMessagesImportErrorHandler,
          useValue: {
            handleError: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<GmailGetMessagesService>(GmailGetMessagesService);
    oAuth2ClientManagerService = module.get<OAuth2ClientManagerService>(
      OAuth2ClientManagerService,
    );

    (
      oAuth2ClientManagerService.getGoogleOAuth2Client as jest.Mock
    ).mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('returns an empty list when SELECTED_FOLDERS has no synced folder external IDs', async () => {
    const mockGmailClient = {
      users: {
        messages: {
          get: jest.fn().mockResolvedValue({
            data: { id: 'msg-1' },
          }),
        },
        threads: {
          get: jest.fn(),
        },
      },
    };

    jest.spyOn(google, 'gmail').mockReturnValue(mockGmailClient as never);

    (parseAndFormatGmailMessage as jest.Mock).mockReturnValue({
      externalId: 'msg-1',
      messageThreadExternalId: 'thread-1',
      labelIds: ['INBOX'],
      participants: [],
    });

    const result = await service.getMessages(['msg-1'], connectedAccount, {
      messageFolderImportPolicy: MessageFolderImportPolicy.SELECTED_FOLDERS,
      messageFolders: [{ isSynced: false, externalId: 'INBOX' }],
    } as never);

    expect(result).toEqual([]);
    expect(mockGmailClient.users.threads.get).not.toHaveBeenCalled();
  });
});
