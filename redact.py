import re

def censor_file(file_path, sensitive_patterns):
    # Read the file content
    with open(file_path, 'r') as file:
        content = file.read()

    # Replace sensitive patterns
    for pattern in sensitive_patterns:
        content = re.sub(pattern, '[REDACTED]', content)

    # Write the censored content back to the file
    with open(file_path, 'w') as file:
        file.write(content)

if __name__ == "__main__":
    # Define the file path and sensitive patterns
    file_path = 'path/to/your/file.txt'
    sensitive_patterns = [
        r'your_api_key_pattern',  # Replace with actual patterns
        r'another_sensitive_string',
    ]

    censor_file(file_path, sensitive_patterns)
