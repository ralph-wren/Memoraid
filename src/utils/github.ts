export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

export const validateGitHubConnection = async (config: GitHubConfig): Promise<boolean> => {
    const { token, owner, repo } = config;
    const url = `https://api.github.com/repos/${owner}/${repo}`;
    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
        }
    });
    return response.ok;
}

export const getDirectories = async (config: GitHubConfig): Promise<string[]> => {
  const { token, owner, repo, branch } = config;
  // Use the Tree API for efficiency with recursive=1
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub API Error: ${response.statusText}`);
  }

  const data = await response.json();
  
  // Filter for trees (directories)
  const dirs = data.tree
    .filter((item: any) => item.type === 'tree')
    .map((item: any) => item.path);
    
  return ['/', ...dirs]; // Add root
};

export const pushToGitHub = async (
  config: GitHubConfig, 
  path: string, 
  content: string, 
  message: string
): Promise<{ url: string }> => {
  const { token, owner, repo, branch } = config;
  // Ensure path doesn't start with /
  const cleanPath = path.startsWith('/') ? path.substring(1) : path;
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${cleanPath}`;

  // 1. Check if file exists to get SHA
  let sha: string | undefined;
  try {
    const checkResponse = await fetch(`${apiUrl}?ref=${branch}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
      }
    });
    
    if (checkResponse.ok) {
      const data = await checkResponse.json();
      sha = data.sha;
    }
  } catch (e) {
    // Ignore error, assume file doesn't exist
  }

  // 2. Create or Update file
  // UTF-8 safe base64 encoding
  const utf8Bytes = new TextEncoder().encode(content);
  let binary = '';
  for (let i = 0; i < utf8Bytes.length; i++) {
    binary += String.fromCharCode(utf8Bytes[i]);
  }
  const contentBase64 = btoa(binary);

  const payload = {
    message,
    content: contentBase64,
    branch,
    ...(sha ? { sha } : {})
  };

  const putResponse = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload)
  });

  if (!putResponse.ok) {
    const errorData = await putResponse.json();
    throw new Error(`Push Failed: ${errorData.message || putResponse.statusText}`);
  }

  const result = await putResponse.json();
  return { url: result.content.html_url };
};
