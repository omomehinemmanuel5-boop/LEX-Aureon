from setuptools import setup, find_packages

setup(
    name="lex-aureon",
    version="1.0.0",
    description="Official Python SDK for Lex Aureon Constitutional Governance API",
    author="Emmanuel King",
    author_email="lexaureon@gmail.com",
    url="https://github.com/omomehinemmanuel5-boop/LEX-Aureon",
    license="MIT",
    py_modules=["lex_aureon"],
    install_requires=[
        "httpx>=0.24.0",
    ],
    extras_require={
        "dev": [
            "pytest>=7.0",
            "pytest-asyncio>=0.21.0",
            "black>=23.0",
            "mypy>=1.0",
        ],
    },
    python_requires=">=3.8",
    keywords=[
        "lex-aureon",
        "constitutional-ai",
        "governance",
        "llm-safety",
        "lyapunov",
    ],
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
    ],
)
