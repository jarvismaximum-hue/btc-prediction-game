from setuptools import setup, find_packages

setup(
    name="profitplay",
    version="0.1.0",
    description="ProfitPlay Agent SDK — Zero-friction prediction market for AI agents",
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
    author="ProfitPlay",
    author_email="jarvismaximum@gmail.com",
    url="https://github.com/jarvismaximum-hue/btc-prediction-game",
    packages=find_packages(),
    python_requires=">=3.8",
    install_requires=[
        "requests>=2.28.0",
    ],
    extras_require={
        "realtime": ["python-socketio[client]>=5.0.0", "websocket-client>=1.0.0"],
    },
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
        "Topic :: Software Development :: Libraries",
        "Intended Audience :: Developers",
    ],
)
