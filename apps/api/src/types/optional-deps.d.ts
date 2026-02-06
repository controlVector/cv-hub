// Type declarations for optional dependencies
// These modules are dynamically imported only when needed

declare module '@aws-sdk/client-ssm' {
  export interface SSMClientConfig {
    region?: string;
    credentials?: {
      accessKeyId: string;
      secretAccessKey: string;
    };
  }

  export class SSMClient {
    constructor(config: SSMClientConfig);
    send<T>(command: T): Promise<any>;
  }

  export class DescribeParametersCommand {
    constructor(input: { MaxResults?: number });
  }

  export class GetParameterCommand {
    constructor(input: { Name: string; WithDecryption?: boolean });
  }

  export class PutParameterCommand {
    constructor(input: {
      Name: string;
      Value: string;
      Type?: string;
      Overwrite?: boolean;
      Description?: string;
    });
  }

  export class DeleteParameterCommand {
    constructor(input: { Name: string });
  }

  export class GetParametersByPathCommand {
    constructor(input: {
      Path: string;
      Recursive?: boolean;
      WithDecryption?: boolean;
      MaxResults?: number;
      NextToken?: string;
    });
  }

  export class GetParameterHistoryCommand {
    constructor(input: { Name: string; WithDecryption?: boolean });
  }
}
