import { ConfigurationItem, Connection } from "vscode-languageserver";

export async function getConfiguration(conn: Connection): Promise<any> {
    const configItems: ConfigurationItem[] = [{ section: 'enscript' }];
    const result = await conn.workspace.getConfiguration(configItems);
    return result[0]; // The full `enscript` config object
}