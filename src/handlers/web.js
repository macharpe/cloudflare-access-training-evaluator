import { updateUserTrainingStatusByEmail } from '../database/training.js'

/**
 * Get all users from the database
 * @param {*} env - Environment bindings
 * @returns {Array} List of users with their training status
 */
async function getAllUsers(env) {
  try {
    const result = await env.DB.prepare(
      'SELECT id, username, first_name, primary_email, training_status, created_at, updated_at FROM users ORDER BY username',
    ).all()

    return result.results || []
  } catch (error) {
    console.error('Database error:', error)
    return []
  }
}

/**
 * Handle GET request for the web interface
 * @param {*} env - Environment bindings
 * @returns {Response} HTML response
 */
export async function handleWebInterface(env) {
  const users = await getAllUsers(env)

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Training Completion Status</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 50%, #90caf9 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(135deg, #1976d2 0%, #2196f3 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        
        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            font-weight: 600;
        }
        
        .header p {
            font-size: 1.1rem;
            opacity: 0.9;
        }
        
        .content {
            padding: 30px;
        }
        
        .controls {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 8px;
            border-left: 4px solid #2196f3;
        }
        
        .sync-button {
            background: linear-gradient(135deg, #1976d2 0%, #2196f3 100%);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            font-weight: 600;
            transition: all 0.3s ease;
            box-shadow: 0 2px 8px rgba(33,150,243,0.2);
        }
        
        .sync-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 16px rgba(33,150,243,0.3);
        }
        
        .sync-button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        
        .sync-status {
            font-weight: 600;
            color: #333;
        }
        
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            border-left: 4px solid #2196f3;
            transition: transform 0.2s ease;
        }
        
        .stat-card:hover {
            transform: translateY(-2px);
        }
        
        .stat-number {
            font-size: 2rem;
            font-weight: bold;
            color: #1976d2;
        }
        
        .stat-label {
            color: #666;
            margin-top: 5px;
            font-weight: 500;
        }
        
        .table-container {
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
        }
        
        th {
            background: #1976d2;
            color: white;
            padding: 15px;
            text-align: left;
            font-weight: 600;
        }
        
        td {
            padding: 15px;
            border-bottom: 1px solid #eee;
        }
        
        tr:hover {
            background-color: #f3f9ff;
        }
        
        .status-select {
            background: white;
            border: 2px solid #ddd;
            border-radius: 6px;
            padding: 8px 12px;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.3s ease;
            font-weight: 500;
        }
        
        .status-select:focus {
            outline: none;
            border-color: #2196f3;
            box-shadow: 0 0 0 3px rgba(33,150,243,0.1);
        }
        
        .status-completed {
            background-color: #d4edda;
            color: #155724;
            border-color: #c3e6cb;
        }
        
        .status-started {
            background-color: #fff3cd;
            color: #856404;
            border-color: #ffeaa7;
        }
        
        .status-not-started {
            background-color: #f8d7da;
            color: #721c24;
            border-color: #f5c6cb;
        }
        
        .username {
            font-weight: 600;
            color: #333;
            font-size: 1.1rem;
        }
        
        .email {
            color: #666;
            font-size: 0.95rem;
            font-family: monospace;
        }
        
        .timestamp {
            color: #666;
            font-size: 0.9rem;
        }
        
        .loading {
            opacity: 0.6;
            pointer-events: none;
        }
        
        .success-message {
            background: #d4edda;
            color: #155724;
            padding: 12px 20px;
            border-radius: 6px;
            margin: 10px 0;
            display: none;
            border-left: 4px solid #28a745;
        }
        
        .error-message {
            background: #f8d7da;
            color: #721c24;
            padding: 12px 20px;
            border-radius: 6px;
            margin: 10px 0;
            display: none;
            border-left: 4px solid #dc3545;
        }
        
        .access-indicator {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 0.8rem;
            font-weight: 600;
            margin-left: 10px;
        }
        
        .access-granted {
            background-color: #d4edda;
            color: #155724;
        }
        
        .access-denied {
            background-color: #f8d7da;
            color: #721c24;
        }
        
        @media (max-width: 768px) {
            .header h1 {
                font-size: 2rem;
            }
            
            .content {
                padding: 20px;
            }
            
            table {
                font-size: 14px;
            }
            
            th, td {
                padding: 10px;
            }
            
            .stats {
                grid-template-columns: repeat(2, 1fr);
            }
        }
        
        @media (max-width: 480px) {
            .stats {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Training Completion Status for the Team</h1>
            <p>Manage and track training certification progress</p>
        </div>
        
        <div class="content">
            <div class="success-message" id="successMessage">Training status updated successfully!</div>
            <div class="error-message" id="errorMessage">Failed to update training status. Please try again.</div>
            
            <div class="controls">
                <div class="sync-status">
                    <span id="syncStatus">Ready to sync users from Okta</span>
                </div>
                <button class="sync-button" id="syncButton" onclick="syncOktaUsers()">
                    🔄 Sync Users from Okta
                </button>
            </div>
            
            <div class="stats">
                <div class="stat-card">
                    <div class="stat-number" id="completedCount">${users.filter((u) => u.training_status === 'completed').length}</div>
                    <div class="stat-label">Completed</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="startedCount">${users.filter((u) => u.training_status === 'started').length}</div>
                    <div class="stat-label">In Progress</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="notStartedCount">${users.filter((u) => u.training_status === 'not started').length}</div>
                    <div class="stat-label">Not Started</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${users.length}</div>
                    <div class="stat-label">Total Users</div>
                </div>
            </div>
            
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>First Name</th>
                            <th>Primary Email</th>
                            <th>Training Status</th>
                            <th>Access Status</th>
                            <th>Last Updated</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${users
                          .map(
                            (user) => `
                            <tr data-user-id="${user.id}">
                                <td class="username">${user.first_name || '-'}</td>
                                <td class="email">${user.primary_email || '-'}</td>
                                <td>
                                    <select class="status-select status-${user.training_status.replace(' ', '-')}" 
                                            onchange="updateTrainingStatus('${user.primary_email}', this.value, this)" 
                                            data-original-value="${user.training_status}">
                                        <option value="not started" ${user.training_status === 'not started' ? 'selected' : ''}>Not Started</option>
                                        <option value="started" ${user.training_status === 'started' ? 'selected' : ''}>In Progress</option>
                                        <option value="completed" ${user.training_status === 'completed' ? 'selected' : ''}>Completed</option>
                                    </select>
                                </td>
                                <td>
                                    <span class="access-indicator ${user.training_status === 'completed' ? 'access-granted' : 'access-denied'}">
                                        ${user.training_status === 'completed' ? '✅ Access Granted' : '❌ Access Denied'}
                                    </span>
                                </td>
                                <td class="timestamp">${new Date(user.updated_at).toLocaleString()}</td>
                            </tr>
                        `,
                          )
                          .join('')}
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <script>
        async function updateTrainingStatus(email, newStatus, selectElement) {
            const originalValue = selectElement.getAttribute('data-original-value');
            
            if (newStatus === originalValue) {
                return; // No change
            }
            
            // Add loading state
            selectElement.classList.add('loading');
            
            try {
                const response = await fetch('/api/update-training', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        email: email,
                        status: newStatus
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    // Update the select styling
                    selectElement.className = 'status-select status-' + newStatus.replace(' ', '-');
                    selectElement.setAttribute('data-original-value', newStatus);
                    
                    // Update timestamp
                    const row = selectElement.closest('tr');
                    const timestampCell = row.querySelector('.timestamp');
                    timestampCell.textContent = new Date().toLocaleString();
                    
                    // Update access status
                    const accessCell = row.querySelector('.access-indicator');
                    if (newStatus === 'completed') {
                        accessCell.className = 'access-indicator access-granted';
                        accessCell.textContent = '✅ Access Granted';
                    } else {
                        accessCell.className = 'access-indicator access-denied';
                        accessCell.textContent = '❌ Access Denied';
                    }
                    
                    // Update stats
                    updateStats();
                    
                    // Show success message
                    showMessage('success', 'Training status updated successfully!');
                } else {
                    // Revert selection
                    selectElement.value = originalValue;
                    showMessage('error', result.message || 'Failed to update training status');
                }
            } catch (error) {
                console.error('Error updating training status:', error);
                // Revert selection
                selectElement.value = originalValue;
                showMessage('error', 'Network error. Please try again.');
            } finally {
                selectElement.classList.remove('loading');
            }
        }
        
        function updateStats() {
            const selects = document.querySelectorAll('.status-select');
            let completed = 0, started = 0, notStarted = 0;
            
            selects.forEach(select => {
                const status = select.value;
                if (status === 'completed') completed++;
                else if (status === 'started') started++;
                else if (status === 'not started') notStarted++;
            });
            
            document.getElementById('completedCount').textContent = completed;
            document.getElementById('startedCount').textContent = started;
            document.getElementById('notStartedCount').textContent = notStarted;
        }
        
        async function syncOktaUsers() {
            const syncButton = document.getElementById('syncButton');
            const syncStatus = document.getElementById('syncStatus');
            
            // Disable button and show loading state
            syncButton.disabled = true;
            syncButton.textContent = '🔄 Syncing...';
            syncStatus.textContent = 'Syncing users from Okta...';
            
            try {
                const response = await fetch('/api/okta/sync', {
                    method: 'POST'
                });
                
                const result = await response.json();
                
                if (result.success) {
                    syncStatus.textContent = \`Sync completed: Added \${result.results.added}, Updated \${result.results.updated}, Skipped \${result.results.skipped}\`;
                    showMessage('success', result.message);
                    
                    // Refresh the page to show new users
                    setTimeout(() => {
                        window.location.reload();
                    }, 2000);
                } else {
                    syncStatus.textContent = 'Sync failed';
                    showMessage('error', result.message || 'Failed to sync users from Okta');
                }
            } catch (error) {
                console.error('Sync error:', error);
                syncStatus.textContent = 'Sync failed';
                showMessage('error', 'Network error during sync. Please try again.');
            } finally {
                // Re-enable button
                syncButton.disabled = false;
                syncButton.textContent = '🔄 Sync Users from Okta';
                
                // Reset status after delay
                setTimeout(() => {
                    syncStatus.textContent = 'Ready to sync users from Okta';
                }, 5000);
            }
        }
        
        function showMessage(type, message) {
            const successMsg = document.getElementById('successMessage');
            const errorMsg = document.getElementById('errorMessage');
            
            // Hide both messages first
            successMsg.style.display = 'none';
            errorMsg.style.display = 'none';
            
            if (type === 'success') {
                successMsg.textContent = message;
                successMsg.style.display = 'block';
                setTimeout(() => successMsg.style.display = 'none', 3000);
            } else {
                errorMsg.textContent = message;
                errorMsg.style.display = 'block';
                setTimeout(() => errorMsg.style.display = 'none', 5000);
            }
        }
    </script>
</body>
</html>
  `

  return new Response(html, {
    headers: { 'content-type': 'text/html' },
  })
}

/**
 * Handle API request to update training status
 * @param {*} env - Environment bindings
 * @param {Request} request - HTTP request
 * @returns {Response} JSON response
 */
export async function handleUpdateTraining(env, request) {
  try {
    const body = await request.json()
    const { email, status } = body

    if (!email || !status) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Email and status are required',
        }),
        {
          status: 400,
          headers: { 'content-type': 'application/json' },
        },
      )
    }

    if (!['not started', 'started', 'completed'].includes(status)) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Invalid status value',
        }),
        {
          status: 400,
          headers: { 'content-type': 'application/json' },
        },
      )
    }

    const updated = await updateUserTrainingStatusByEmail(env, email, status)

    if (updated) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Training status updated successfully',
        }),
        {
          headers: { 'content-type': 'application/json' },
        },
      )
    } else {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'User not found or update failed',
        }),
        {
          status: 404,
          headers: { 'content-type': 'application/json' },
        },
      )
    }
  } catch (error) {
    console.error('Update training error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Internal server error',
      }),
      {
        status: 500,
        headers: { 'content-type': 'application/json' },
      },
    )
  }
}
